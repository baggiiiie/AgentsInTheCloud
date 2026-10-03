import { agentsInTheCloudDataPath, getAgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import { readJsonSettings, updateJsonSettings } from "@agents-in-the-cloud/core/json-settings";
import { Type } from "typebox";
import { Value } from "typebox/value";

export const transcriptionModels = [
  {
    id: "nemotron-3.5", name: "Nemotron 3.5", description: "Multilingual streaming transcription",
    artifact: { repository: "nvidia/nemotron-3.5-asr-streaming-0.6b", revision: "1c8deaecc64b91f034d73e08dd8b64625eb3395d", filename: "nemotron-3.5-asr-streaming-0.6b.q8_0.gguf", size: 741548352 },
  },
  {
    id: "nemotron-en", name: "Nemotron English", description: "English streaming transcription",
    artifact: { repository: "nvidia/nemotron-speech-streaming-en-0.6b", revision: "ebe59e5a817142986528bbbee5dba8db7b38ed50", filename: "nemotron-speech-streaming-en-0.6b.q8_0.gguf", size: 699872960 },
  },
] as const;

export type TranscriptionModelId = (typeof transcriptionModels)[number]["id"];
export const defaultTranscriptionModel: TranscriptionModelId = "nemotron-en";

const settingsSchema = Type.Object({
  model: Type.Optional(Type.Union([
    ...transcriptionModels.map(({ id }) => Type.Literal(id)),
    // Accept retired selections in older persisted settings only.
    Type.Literal("parakeet-tdt"),
    Type.Literal("parakeet-ctc"),
  ])),
});

function settingsPath(): string {
  return agentsInTheCloudDataPath(getAgentsInTheCloudRuntimeContext(), "transcription.json");
}

export function isTranscriptionModelId(value: string): value is TranscriptionModelId {
  return transcriptionModels.some((model) => model.id === value);
}

export function transcriptionModel(id: TranscriptionModelId): (typeof transcriptionModels)[number] {
  const model = transcriptionModels.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`unsupported transcription model: ${id}`);
  return model;
}

export async function readTranscriptionModel(): Promise<TranscriptionModelId> {
  const { model } = Value.Parse(settingsSchema, await readJsonSettings(settingsPath()));
  return model && isTranscriptionModelId(model) ? model : defaultTranscriptionModel;
}

export async function writeTranscriptionModel(model: TranscriptionModelId): Promise<void> {
  await updateJsonSettings(settingsPath(), (settings) => {
    settings.model = model;
  });
}
