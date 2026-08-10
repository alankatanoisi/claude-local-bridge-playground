'use strict';

/**
 * WorkerRegistry is the provider-neutral boundary.
 *
 * Starlark may request a symbolic worker such as `repo_file_analyst`, but it
 * never sees a provider credential or a model ID. The host resolves that
 * symbolic name through a route that the user configured before the run.
 */
class WorkerRegistry {
  constructor({ profiles, routes, providers }) {
    this.profiles = new Map(Object.entries(profiles || {}));
    this.routes = new Map(Object.entries(routes || {}));
    this.providers = new Map(Object.entries(providers || {}));
    this.validateConfiguration();
  }

  validateConfiguration() {
    if (this.profiles.size === 0) throw new Error('worker registry requires at least one profile');

    for (const [name, profile] of this.profiles) {
      if (!profile || typeof profile !== 'object') throw new Error(`worker profile '${name}' must be an object`);
      if (profile.model !== undefined || profile.provider !== undefined) {
        throw new Error(`worker profile '${name}' cannot choose a model or provider`);
      }
      if (!profile.route || !this.routes.has(profile.route)) {
        throw new Error(`worker profile '${name}' references unknown route '${profile.route || ''}'`);
      }
      if (typeof profile.system !== 'string' || !profile.system.trim()) {
        throw new Error(`worker profile '${name}' requires a system instruction`);
      }
      if (!Number.isInteger(profile.maxOutputTokens) || profile.maxOutputTokens < 100) {
        throw new Error(`worker profile '${name}' requires a bounded maxOutputTokens`);
      }
    }

    for (const [name, route] of this.routes) {
      if (!route || typeof route !== 'object') throw new Error(`worker route '${name}' must be an object`);
      if (!route.provider || !this.providers.has(route.provider)) {
        throw new Error(`worker route '${name}' references unknown provider '${route.provider || ''}'`);
      }
      if (typeof route.model !== 'string' || !route.model.trim()) {
        throw new Error(`worker route '${name}' requires a host-selected model`);
      }
    }
  }

  publicProfiles() {
    return [...this.profiles.entries()].map(([name, profile]) => ({
      name,
      description: profile.description || '',
      max_output_tokens: profile.maxOutputTokens,
    }));
  }

  profile(name) {
    const profile = this.profiles.get(name);
    if (!profile) throw new Error(`unknown worker '${name}'`);
    return profile;
  }

  async execute({ workerName, prompt, maxTokens, timeoutMs, label }) {
    const profile = this.profile(workerName);
    const route = this.routes.get(profile.route);
    const provider = this.providers.get(route.provider);

    // Only this host-owned layer combines the symbolic worker with a concrete
    // provider and model. Generated Starlark never receives this object.
    return provider.execute({
      model: route.model,
      system: profile.system,
      prompt,
      maxTokens: Math.min(maxTokens, profile.maxOutputTokens),
      effort: profile.effort || route.effort || 'low',
      timeoutMs,
      label,
    });
  }
}

function createBridgeWorkerRegistry({ profiles, bridge, modelRoutes, extraProviders }) {
  return new WorkerRegistry({
    profiles,
    routes: modelRoutes,
    providers: {
      local_claude_bridge: {
        execute: (request) => bridge.call(request),
      },
      // R9: additional host-owned providers (e.g. the deterministic analyst)
      // compose here. Routes select the provider; generated descriptors never
      // see provider names, so a provider swap cannot change what plans say.
      ...(extraProviders || {}),
    },
  });
}

module.exports = { WorkerRegistry, createBridgeWorkerRegistry };
