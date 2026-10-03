// atelier-cgroup-runc delegates only the container's private cgroup namespace.
// It does not grant capabilities, expose devices, or disable seccomp/LSM policy.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

type object = map[string]json.RawMessage

func decode[T any](raw json.RawMessage) (T, error) {
	var value T
	err := json.Unmarshal(raw, &value)
	return value, err
}
func set(o object, key string, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	o[key] = data
}

func delegate(spec object, controls []string) error {
	linux, err := decode[object](spec["linux"])
	if err != nil {
		return err
	}
	namespaces, err := decode[[]struct {
		Type string `json:"type"`
		Path string `json:"path"`
	}](linux["namespaces"])
	if err != nil {
		return err
	}
	private := false
	for _, ns := range namespaces {
		if ns.Type == "cgroup" {
			private = ns.Path == ""
		}
	}
	if !private {
		return fmt.Errorf("cgroup delegation requires a new private cgroup namespace")
	}
	process, err := decode[object](spec["process"])
	if err != nil {
		return err
	}
	caps, err := decode[map[string][]string](process["capabilities"])
	if err != nil {
		return err
	}
	for _, list := range caps {
		for _, cap := range list {
			if cap == "CAP_SYS_ADMIN" {
				return fmt.Errorf("cgroup delegation must not grant CAP_SYS_ADMIN")
			}
		}
	}
	mounts, err := decode[[]object](spec["mounts"])
	if err != nil {
		return err
	}
	count := 0
	for _, mount := range mounts {
		dest, err := decode[string](mount["destination"])
		if err != nil {
			return err
		}
		if dest != "/sys/fs/cgroup" {
			continue
		}
		kind, err := decode[string](mount["type"])
		if err != nil {
			return err
		}
		if kind != "cgroup" && kind != "cgroup2" {
			return fmt.Errorf("cgroup delegation requires a namespace-scoped cgroup filesystem, not a host bind mount")
		}
		options, err := decode[[]string](mount["options"])
		if err != nil {
			return err
		}
		var writable []string
		for _, option := range options {
			if option != "ro" && option != "rw" {
				writable = append(writable, option)
			}
		}
		set(mount, "options", append(writable, "rw"))
		count++
	}
	if count != 1 {
		return fmt.Errorf("expected exactly one cgroup filesystem mount, got %d", count)
	}
	set(spec, "mounts", mounts)
	var readonly []string
	if raw, ok := linux["readonlyPaths"]; ok {
		readonly, err = decode[[]string](raw)
		if err != nil {
			return err
		}
	}
	// The namespace root is the Docker resource-budget boundary. Delegation allows
	// moving processes and enabling controllers, not raising that boundary's limits.
	for _, control := range controls {
		switch control {
		case "cgroup.procs", "cgroup.threads", "cgroup.subtree_control":
			continue
		}
		readonly = append(readonly, "/sys/fs/cgroup/"+control)
	}
	set(linux, "readonlyPaths", readonly)
	set(spec, "linux", linux)
	return nil
}

func bundleForCreate(args []string) (string, bool, error) {
	command := -1
	for i := 0; i < len(args); i++ {
		if !strings.HasPrefix(args[i], "-") {
			command = i
			break
		}
		switch args[i] {
		case "--root", "--log", "--log-format", "--rootless":
			i++
		}
	}
	if command < 0 || (args[command] != "create" && args[command] != "run") {
		return "", false, nil
	}
	bundle := "."
	for i := command + 1; i < len(args); i++ {
		switch {
		case args[i] == "--bundle" || args[i] == "-b":
			i++
			if i == len(args) {
				return "", false, fmt.Errorf("missing bundle path")
			}
			bundle = args[i]
		case strings.HasPrefix(args[i], "--bundle="):
			bundle = strings.TrimPrefix(args[i], "--bundle=")
		}
	}
	return bundle, true, nil
}

func prepare(args []string) error {
	bundle, create, err := bundleForCreate(args)
	if err != nil || !create {
		return err
	}
	path := filepath.Join(bundle, "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	spec, err := decode[object](data)
	if err != nil {
		return err
	}
	// Enumerate the runtime process's non-root cgroup interfaces so future kernel
	// controllers are protected too. The container cannot influence this inventory.
	membership, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return err
	}
	var group string
	for _, line := range strings.Split(string(membership), "\n") {
		if strings.HasPrefix(line, "0::") {
			group = strings.TrimPrefix(line, "0::")
		}
	}
	if group == "" {
		return fmt.Errorf("cgroup v2 is required")
	}
	entries, err := os.ReadDir(filepath.Join("/sys/fs/cgroup", group))
	if err != nil {
		return err
	}
	var controls []string
	for _, entry := range entries {
		if !entry.IsDir() {
			controls = append(controls, entry.Name())
		}
	}
	if err = delegate(spec, controls); err != nil {
		return err
	}
	data, err = json.Marshal(spec)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func main() {
	if err := prepare(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "atelier-cgroup-runc:", err)
		os.Exit(1)
	}
	// Exec preserves runc's signals, stdio, exit status, and init-process identity.
	if err := syscall.Exec("/usr/sbin/runc", append([]string{"runc"}, os.Args[1:]...), os.Environ()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
