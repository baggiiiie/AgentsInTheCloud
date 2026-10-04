import { randomUUID } from "node:crypto";
import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import { findWorkspaceTemplateRecord, workspaceTemplatesFile, readWorkspaceTemplateStore, updateWorkspaceTemplateStore, type WorkspaceTemplateEnvironmentVariable, type WorkspaceTemplateRecord } from "./workspace-template.ts";

function normalizeName(value: string): string {
  const name = value.trim();
  validateWorkspaceTemplateEnvironmentName(name);
  return name;
}

export function validateWorkspaceTemplateEnvironmentName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new AgentsInTheCloudCoreError("invalid_arguments", "NAME must be an environment variable name");
}

function findVariable(workspaceTemplate: WorkspaceTemplateRecord, variableId: string): WorkspaceTemplateEnvironmentVariable {
  const variable = workspaceTemplate.environment?.find((candidate) => candidate.id === variableId);
  if (!variable) throw new AgentsInTheCloudCoreError("workspace_template_environment_variable_not_found", `template environment variable not found: ${variableId}`);
  return variable;
}

function assertNameAvailable(workspaceTemplate: WorkspaceTemplateRecord, name: string, exceptVariableId?: string): void {
  if (workspaceTemplate.environment?.some((variable) => variable.id !== exceptVariableId && variable.name === name)) throw new AgentsInTheCloudCoreError("workspace_template_environment_variable_exists", "template environment variable already exists");
}

export async function listWorkspaceTemplateEnvironmentVariables(workspaceTemplateId: string, file = workspaceTemplatesFile()): Promise<WorkspaceTemplateEnvironmentVariable[]> {
  const workspaceTemplate = findWorkspaceTemplateRecord(await readWorkspaceTemplateStore(file), workspaceTemplateId);
  return [...(workspaceTemplate.environment ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWorkspaceTemplateEnvironmentVariable(workspaceTemplateId: string, values: { name: string; value: string }, file = workspaceTemplatesFile()): Promise<WorkspaceTemplateEnvironmentVariable> {
  const name = normalizeName(values.name);
  return await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, workspaceTemplateId);
    workspaceTemplate.environment ??= [];
    assertNameAvailable(workspaceTemplate, name);
    const now = new Date().toISOString();
    const variable: WorkspaceTemplateEnvironmentVariable = { id: randomUUID(), projectId: workspaceTemplateId, name, value: values.value, createdAt: now, updatedAt: now };
    workspaceTemplate.environment!.push(variable);
    return variable;
  });
}

export async function updateWorkspaceTemplateEnvironmentVariable(workspaceTemplateId: string, variableId: string, values: { name: string; value: string }, file = workspaceTemplatesFile()): Promise<WorkspaceTemplateEnvironmentVariable> {
  const name = normalizeName(values.name);
  return await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, workspaceTemplateId);
    const variable = findVariable(workspaceTemplate, variableId);
    assertNameAvailable(workspaceTemplate, name, variableId);
    variable.name = name;
    variable.value = values.value;
    variable.updatedAt = new Date().toISOString();
    return variable;
  });
}

export async function deleteWorkspaceTemplateEnvironmentVariable(workspaceTemplateId: string, variableId: string, file = workspaceTemplatesFile()): Promise<WorkspaceTemplateEnvironmentVariable> {
  return await updateWorkspaceTemplateStore(file, (store) => {
    const workspaceTemplate = findWorkspaceTemplateRecord(store, workspaceTemplateId);
    const variable = findVariable(workspaceTemplate, variableId);
    workspaceTemplate.environment = workspaceTemplate.environment!.filter((candidate) => candidate !== variable);
    return variable;
  });
}
