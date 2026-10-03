package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func fixture(t *testing.T) object {
	t.Helper()
	spec, err := decode[object]([]byte(`{"ociVersion":"1.3.0","root":{"path":"rootfs"},"process":{"capabilities":{"bounding":["CAP_CHOWN"]}},"mounts":[{"destination":"/sys/fs/cgroup","type":"cgroup","source":"cgroup","options":["ro","nosuid","nodev","noexec","relatime"]}],"linux":{"namespaces":[{"type":"cgroup"},{"type":"pid"}],"seccomp":{"defaultAction":"SCMP_ACT_ERRNO"},"resources":{"devices":[{"allow":false,"access":"rwm"}]},"readonlyPaths":["/proc/sys"]},"annotations":{"keep":"unchanged"}}`))
	if err != nil {
		t.Fatal(err)
	}
	return spec
}
func TestDelegateKeepsSecurityAndBudget(t *testing.T) {
	spec := fixture(t)
	beforeProcess := string(spec["process"])
	beforeLinux, _ := decode[object](spec["linux"])
	if err := delegate(spec, []string{"cgroup.procs", "cgroup.threads", "cgroup.subtree_control", "memory.max", "cpu.max", "pids.max", "cgroup.kill", "future.limit"}); err != nil {
		t.Fatal(err)
	}
	if string(spec["process"]) != beforeProcess {
		t.Fatal("process security was changed")
	}
	linux, _ := decode[object](spec["linux"])
	for _, key := range []string{"seccomp", "resources", "namespaces"} {
		if string(linux[key]) != string(beforeLinux[key]) {
			t.Fatalf("changed %s", key)
		}
	}
	paths, _ := decode[[]string](linux["readonlyPaths"])
	joined := strings.Join(paths, "\n")
	for _, name := range []string{"memory.max", "cpu.max", "pids.max", "cgroup.kill", "future.limit"} {
		if !strings.Contains(joined, "/sys/fs/cgroup/"+name) {
			t.Fatalf("unprotected budget control %s", name)
		}
	}
	for _, name := range []string{"cgroup.procs", "cgroup.threads", "cgroup.subtree_control"} {
		if strings.Contains(joined, "/sys/fs/cgroup/"+name) {
			t.Fatalf("delegation control blocked %s", name)
		}
	}
	mounts, _ := decode[[]object](spec["mounts"])
	options, _ := decode[[]string](mounts[0]["options"])
	if strings.Join(options, ",") != "nosuid,nodev,noexec,relatime,rw" {
		t.Fatal(options)
	}
	if string(spec["annotations"]) != `{"keep":"unchanged"}` {
		t.Fatal("lost annotations")
	}
}
func TestRefuseUnsafeSpecs(t *testing.T) {
	for _, change := range []func(object){
		func(s object) {
			l, _ := decode[object](s["linux"])
			set(l, "namespaces", []object{})
			set(s, "linux", l)
		},
		func(s object) {
			l, _ := decode[object](s["linux"])
			l["namespaces"] = json.RawMessage(`[{"type":"cgroup","path":"/proc/1/ns/cgroup"}]`)
			set(s, "linux", l)
		},
		func(s object) { s["process"] = json.RawMessage(`{"capabilities":{"bounding":["CAP_SYS_ADMIN"]}}`) },
		func(s object) { m, _ := decode[[]object](s["mounts"]); set(m[0], "type", "bind"); set(s, "mounts", m) },
		func(s object) { set(s, "mounts", []object{}) },
	} {
		s := fixture(t)
		change(s)
		if err := delegate(s, []string{"memory.max"}); err == nil {
			t.Fatal("unsafe spec accepted")
		}
	}
}
func TestRuntimeCommands(t *testing.T) {
	for _, args := range [][]string{{"--root", "/run/runc", "create", "--bundle", "/bundle", "id"}, {"run", "--bundle=/bundle", "id"}, {"create", "-b", "/bundle", "id"}} {
		path, create, err := bundleForCreate(args)
		if err != nil || !create || path != "/bundle" {
			t.Fatal(path, create, err)
		}
	}
	for _, args := range [][]string{{"features"}, {"exec", "id", "sh"}, {"delete", "id"}, {"exec", "id", "run"}, {"delete", "create"}} {
		_, create, err := bundleForCreate(args)
		if err != nil || create {
			t.Fatal(create, err)
		}
	}
	if _, _, err := bundleForCreate([]string{"create", "--bundle"}); err == nil {
		t.Fatal("missing bundle accepted")
	}
}
