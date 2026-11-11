import type { ModelCatalog } from './types';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Used only when the provider omits capability metadata. Unknown model IDs stay
// out of the OCR list; users can still enter a custom vision deployment manually.
export function knownVisionModel(id: string): boolean {
  const name = id.toLowerCase().split('/').pop() ?? '';
  if (/(?:audio|tts|transcri|embedding|image|realtime)/.test(name)) return false;
  return (
    /^(?:gpt-4o(?:-|$)|gpt-4\.[15](?:-|$)|gpt-4-(?:turbo|vision)(?:-|$)|gpt-5(?:[.-]|$))/.test(
      name,
    ) ||
    /^claude-(?:3(?:[.-]|$)|(?:sonnet|opus|haiku)-4(?:[.-]|$))/.test(name) ||
    /^gemini-(?:1\.5|2(?:\.\d+)?|3(?:\.\d+)?)-(?:pro|flash)(?:-|$)/.test(name) ||
    /^qwen[\d.]*-vl(?:-|:|$)/.test(name) ||
    /^(?:llava|llama3\.2-vision|minicpm-v)(?:-|:|$)/.test(name)
  );
}

function supportsVision(value: Record<string, unknown>): boolean {
  const architecture = record(value.architecture);
  const output = architecture.output_modalities ?? value.output_modalities;
  // OCR needs text output, not just an image generator that accepts images.
  if (Array.isArray(output) && !output.includes('text')) return false;
  const input = architecture.input_modalities ?? value.input_modalities;
  if (Array.isArray(input)) return input.includes('image');
  const capabilities = value.capabilities;
  if (Array.isArray(capabilities)) return capabilities.includes('vision');
  const flags = record(capabilities);
  if (typeof flags.vision === 'boolean') return flags.vision;
  if (typeof flags.image_input === 'boolean') return flags.image_input;
  if (typeof architecture.modality === 'string')
    return architecture.modality.split('->')[0]!.split('+').includes('image');
  return knownVisionModel(String(value.id));
}

export function modelCatalog(entries: unknown[]): ModelCatalog {
  const models = new Set<string>();
  const vision = new Map<string, boolean>();
  for (const entry of entries) {
    const model = record(entry);
    if (typeof model.id !== 'string' || !model.id.trim()) continue;
    models.add(model.id);
    // Conflicting duplicate entries must not promote a text-only model to OCR.
    vision.set(model.id, vision.get(model.id) !== false && supportsVision(model));
  }
  return {
    models: [...models].sort(),
    visionModels: [...models].filter((id) => vision.get(id)).sort(),
  };
}
