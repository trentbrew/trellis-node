<template>
  <div>
    <!-- Hero -->
    <section class="relative overflow-hidden border-b border-border/30">
      <ClientOnly>
        <FlickeringGrid
          :color="flickerColor"
          :flicker-chance="0.12"
          :max-opacity="flickerMaxOpacity"
          class="pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_85%_70%_at_50%_0%,#000_50%,transparent_100%)]"
        />
      </ClientOnly>
      <div class="relative mx-auto max-w-6xl px-6 py-20 lg:py-28">
        <div class="max-w-2xl">
          <h1 class="text-4xl font-bold tracking-tight sm:text-5xl lg:text-[3.25rem] lg:leading-[1.15]">
            Local graph state.<br />
            Inspectable agents.<br />
            Peer-first sync.
          </h1>

          <p class="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
            Trellis is a local-first agentic OS runtime: an owned causal graph substrate
            for programmable views, auditable agents, and machine-readable knowledge.
          </p>

          <div class="mt-10 flex flex-wrap items-center gap-4">
            <UiButton size="lg" as="a" href="/getting-started/introduction">
              Read the docs
              <Icon name="lucide:arrow-right" class="ml-1 size-4" />
            </UiButton>
            <UiButton
              size="lg"
              variant="outline"
              as="a"
              href="https://github.com/trentbrew/trellis"
              target="_blank"
            >
              <Icon name="radix-icons:github-logo" class="mr-1 size-4" />
              GitHub
            </UiButton>
          </div>

          <div class="mt-8 max-w-sm rounded-lg border border-border/60 bg-background/60 p-4 backdrop-blur-sm">
            <div class="flex items-center gap-3 font-mono text-sm">
              <span class="select-none text-muted-foreground">$</span>
              <span>npm install -g trellis</span>
              <button
                class="ml-auto text-muted-foreground transition-colors hover:text-foreground"
                @click="copyInstall"
              >
                <Icon :name="copied ? 'lucide:check' : 'lucide:copy'" class="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Why It Clicks -->
    <section class="border-b border-border/30 py-20 lg:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-12 max-w-3xl">
          <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Why It Clicks
          </p>
          <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Trellis keeps the parts most systems split apart
          </h2>
        </div>

        <div class="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <div
            v-for="advantage in advantages"
            :key="advantage.title"
            class="rounded-lg border border-border/50 p-6"
          >
            <div class="flex size-10 items-center justify-center rounded-md border border-border/50">
              <Icon :name="advantage.icon" class="size-5 text-muted-foreground" />
            </div>
            <h3 class="mt-4 text-lg font-semibold">{{ advantage.title }}</h3>
            <p class="mt-3 text-sm leading-7 text-muted-foreground">
              {{ advantage.description }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 15-Second Demo -->
    <section class="border-b border-border/30 py-20 lg:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-8 max-w-3xl">
          <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            See It Work
          </p>
          <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            One mutation, four artifacts
          </h2>
          <p class="mt-4 text-lg text-muted-foreground">
            Pick a surface and see what a single write produces.
          </p>
        </div>

        <div class="flex flex-wrap gap-2 mb-6">
          <button
            v-for="scenario in scenarios"
            :key="scenario.key"
            class="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors"
            :class="
              activeScenario === scenario.key
                ? 'border-border bg-muted text-foreground'
                : 'border-border/60 text-muted-foreground hover:text-foreground'
            "
            @click="activeScenario = scenario.key"
          >
            <Icon :name="scenario.icon" class="size-4" />
            {{ scenario.tab }}
          </button>
        </div>

        <div class="rounded-lg border border-border/50">
          <div class="p-5">
            <div class="grid gap-4">
              <div class="rounded-lg border border-border/50 p-4">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      {{ activeScenarioData.eyebrow }}
                    </p>
                    <h3 class="mt-2 text-xl font-semibold">{{ activeScenarioData.headline }}</h3>
                    <p class="mt-2 text-sm leading-6 text-muted-foreground">
                      {{ activeScenarioData.description }}
                    </p>
                  </div>
                  <div class="hidden rounded-md border border-border/50 px-3 py-2 text-right text-xs text-muted-foreground sm:block">
                    <div>{{ activeScenarioData.metricLabel }}</div>
                    <div class="mt-1 text-lg font-semibold text-foreground">
                      {{ activeScenarioData.metricValue }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-4 lg:grid-cols-2">
                <div class="grid gap-4">
                  <div class="rounded-lg border border-border/50 p-4">
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Action
                        </p>
                        <h4 class="mt-1 text-sm font-semibold">{{ activeScenarioData.action }}</h4>
                      </div>
                      <span class="rounded-md border border-border/60 px-2 py-1 font-mono text-xs text-muted-foreground">
                        {{ activeScenarioData.mutation }}
                      </span>
                    </div>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <div
                        v-for="fact in activeScenarioData.state"
                        :key="fact.label"
                        class="rounded-md border border-border/50 p-3"
                      >
                        <div class="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          {{ fact.label }}
                        </div>
                        <div class="mt-2 text-sm font-medium leading-6">{{ fact.value }}</div>
                      </div>
                    </div>
                  </div>

                  <div class="rounded-lg border border-border/50 p-4">
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Live Query
                        </p>
                        <h4 class="mt-1 font-mono text-sm">{{ activeScenarioData.query }}</h4>
                      </div>
                      <span class="rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-muted-foreground">
                        auto-updates
                      </span>
                    </div>
                    <div class="space-y-2">
                      <div
                        v-for="row in activeScenarioData.results"
                        :key="row"
                        class="rounded-md border border-border/50 px-3 py-2 font-mono text-xs text-muted-foreground"
                      >
                        {{ row }}
                      </div>
                    </div>
                  </div>
                </div>

                <div class="grid gap-4">
                  <div class="rounded-lg border border-border/50 p-4">
                    <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Op Stream
                    </p>
                    <div class="mt-3 space-y-2">
                      <div
                        v-for="op in activeScenarioData.ops"
                        :key="op"
                        class="rounded-md border border-border/50 px-3 py-2 font-mono text-xs text-muted-foreground"
                      >
                        {{ op }}
                      </div>
                    </div>
                  </div>

                  <div class="rounded-lg border border-border/50 p-4">
                    <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Why It Happened
                    </p>
                    <p class="mt-3 text-sm leading-6 text-muted-foreground">
                      {{ activeScenarioData.why }}
                    </p>
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <span
                  v-for="outcome in activeScenarioData.outcomes"
                  :key="outcome"
                  class="rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground"
                >
                  {{ outcome }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Product Surfaces -->
    <section class="border-b border-border/30 py-20 lg:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-12 max-w-3xl">
          <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Product Surfaces
          </p>
          <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            One local-first substrate, many surfaces
          </h2>
          <p class="mt-4 text-lg text-muted-foreground">
            The local graph remains the source of truth. Desktop apps, browser gateways,
            relays, SDKs, and hosted services are surfaces over the same substrate.
          </p>
        </div>

        <div class="grid gap-6 lg:grid-cols-3">
          <div
            v-for="surface in surfaces"
            :key="surface.title"
            class="rounded-lg border border-border/50 p-6"
          >
            <div class="flex size-10 items-center justify-center rounded-md border border-border/50">
              <Icon :name="surface.icon" class="size-5 text-muted-foreground" />
            </div>
            <h3 class="mt-5 text-xl font-semibold">{{ surface.title }}</h3>
            <p class="mt-3 text-sm leading-7 text-muted-foreground">{{ surface.description }}</p>
            <div class="mt-5 rounded-md border border-border/50 p-4">
              <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">What lands</div>
              <div class="mt-2 text-sm font-medium leading-6">{{ surface.proof }}</div>
            </div>
            <a
              :href="surface.href"
              class="mt-5 inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
            >
              {{ surface.cta }}
              <Icon name="lucide:arrow-right" class="size-4" />
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- Five Pillars -->
    <section class="border-b border-border/30 py-20 lg:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-12 max-w-3xl">
          <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Architecture
          </p>
          <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">The Five Pillars</h2>
          <p class="mt-4 text-lg text-muted-foreground">
            The product story is broader than version control, but the core architecture still
            depends on causal state, semantic structure, narrative checkpoints, governance, and memory.
          </p>
        </div>

        <div class="grid gap-6 md:grid-cols-2 xl:grid-cols-5">
          <div
            v-for="pillar in pillars"
            :key="pillar.title"
            class="rounded-lg border border-border/50 p-5"
          >
            <div class="flex size-9 items-center justify-center rounded-md border border-border/50">
              <Icon :name="pillar.icon" class="size-5 text-muted-foreground" />
            </div>
            <h3 class="mt-4 font-semibold">{{ pillar.title }}</h3>
            <p class="mt-2 text-sm leading-6 text-muted-foreground">{{ pillar.description }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Git Comparison -->
    <section class="border-b border-border/30 py-20 lg:py-24">
      <div class="mx-auto max-w-5xl px-6">
        <div class="mb-12 text-center">
          <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            For Git Users
          </p>
          <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Familiar shape, much larger surface area
          </h2>
          <p class="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Git is still the quickest bridge for understanding Trellis. It just should not be the
            whole pitch.
          </p>
        </div>

        <div class="overflow-hidden rounded-lg border border-border/50">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border/50 bg-muted/20">
                <th class="px-6 py-4 text-left font-medium text-muted-foreground">Git</th>
                <th class="px-6 py-4 text-left font-medium">Trellis</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in comparison"
                :key="i"
                class="border-b border-border/30 last:border-0"
              >
                <td class="px-6 py-4 font-mono text-xs text-muted-foreground">{{ row.git }}</td>
                <td class="px-6 py-4 font-mono text-xs">{{ row.trellis }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="py-20 lg:py-24">
      <div class="mx-auto max-w-4xl px-6 text-center">
        <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Start Here
        </p>
        <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Build where local ownership and inspectable history matter
        </h2>
        <p class="mt-4 text-lg leading-8 text-muted-foreground">
          Start with the local-first model, then pick the surface you care about first:
          runtime, protocol, client SDK, or roadmap.
        </p>
        <div class="mt-10 flex flex-wrap items-center justify-center gap-4">
          <UiButton size="lg" as="a" href="/getting-started/introduction">
            Read the introduction
          </UiButton>
          <UiButton size="lg" variant="outline" as="a" href="https://www.npmjs.com/package/trellis" target="_blank">
            View on npm
          </UiButton>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-border/30 py-8">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-muted-foreground">
        <div class="flex items-center gap-2">
          <img src="/logo.svg" alt="Trellis" class="size-4 opacity-60 invert dark:invert-0" />
          <span>trellis</span>
        </div>
        <div class="flex items-center gap-6">
          <a href="https://github.com/trentbrew/trellis" target="_blank" class="transition-colors hover:text-foreground">GitHub</a>
          <a href="https://www.npmjs.com/package/trellis" target="_blank" class="transition-colors hover:text-foreground">npm</a>
          <a href="/getting-started/introduction" class="transition-colors hover:text-foreground">Docs</a>
          <span>Built by <a href="https://turtle.tech" target="_blank" class="transition-colors hover:text-foreground">turtle.tech</a></span>
        </div>
      </div>
    </footer>
  </div>
</template>

<script lang="ts" setup>
  definePageMeta({ layout: "home" });

  useSeoMeta({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    ogTitle: SITE_TITLE,
    ogDescription: SITE_DESCRIPTION,
    twitterTitle: SITE_TITLE,
    twitterDescription: SITE_DESCRIPTION,
    twitterCard: "summary_large_image",
  });

  const colorMode = useColorMode();
  const flickerColor = computed(() =>
    colorMode.value === "dark" ? "rgb(148, 163, 184)" : "rgb(15, 23, 42)",
  );
  const flickerMaxOpacity = computed(() => (colorMode.value === "dark" ? 0.35 : 0.18));

  const copied = ref(false);
  const copyInstall = async () => {
    await navigator.clipboard.writeText("npm install -g trellis");
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  };

  const surfaces = [
    {
      icon: "lucide:database-zap",
      title: "Local runtime",
      description:
        "Run graph state locally with embedded persistence, queries, identity, and live runtime direction.",
      proof: "Local mode already embeds the kernel and SQLite-backed state through the TypeScript client.",
      href: "/architecture/runtime",
      cta: "Explore the runtime",
    },
    {
      icon: "lucide:bot",
      title: "Agent runtime with memory",
      description:
        "Treat each tool call as a durable event. The graph stores not just what changed, but the trail of why it changed.",
      proof: "MCP tools and decision capture let precedent accumulate instead of disappearing into prompts and chat logs.",
      href: "/guides/decision-traces",
      cta: "See decision traces",
    },
    {
      icon: "lucide:git-branch-plus",
      title: "Protocol and SDK",
      description:
        "Use EAV graph state, EQL-S, causal ops, and client bindings as reusable infrastructure.",
      proof: "The SDK exposes local and remote modes while protocol work pushes toward portable trajectories and ontologies.",
      href: "/protocol/overview",
      cta: "See the protocol",
    },
  ];

  const advantages = [
    {
      icon: "lucide:scroll-text",
      title: "History stays attached",
      description:
        "Current state and the event stream live in the same model, so replay, audit, and rollback are native instead of bolted on.",
    },
    {
      icon: "lucide:search-code",
      title: "Queries stay live",
      description:
        "The same system that stores data also answers structured queries and can keep UI results updated over WebSockets.",
    },
    {
      icon: "lucide:file-stack",
      title: "Reasons become data",
      description:
        "Decisions, tool calls, and exceptions can be captured as first-class records instead of disappearing into Slack and memory.",
    },
    {
      icon: "lucide:waypoints",
      title: "Collaboration stays causal",
      description:
        "Sync, branching, and reconciliation work on the op stream itself, which makes distributed work easier to inspect and merge.",
    },
  ];

  const pillars = [
    {
      icon: "lucide:git-commit-horizontal",
      title: "Causal Stream",
      description:
        "An immutable ledger of fine-grained changes with content-addressed hashes and causal chaining.",
    },
    {
      icon: "lucide:git-merge",
      title: "Semantic Patching",
      description:
        "Code-aware changes that operate on structure, not just lines, so merges and refactors can be meaning-aware.",
    },
    {
      icon: "lucide:bookmark",
      title: "Narrative Milestones",
      description:
        "Human-readable story beats layered over continuous work instead of forcing everything into commits.",
    },
    {
      icon: "lucide:shield-check",
      title: "Governance Subgraph",
      description:
        "Identity, signing, and permissions embedded into the same graph rather than delegated to an external authority.",
    },
    {
      icon: "lucide:sprout",
      title: "Idea Garden",
      description:
        "Abandoned exploration stays searchable and revivable, turning discarded work into a reusable asset.",
    },
  ];

  const comparison = [
    { git: "git add + commit", trellis: "Automatic mutation log + queryable causal ops" },
    { git: "git log", trellis: "trellis log plus stateful graph queries" },
    { git: "git tag", trellis: "Narrative milestones over a range of ops" },
    { git: "git branch", trellis: "Branches plus sync and reconciliation policies" },
    { git: "git diff", trellis: "File diff, semantic diff, and live entity queries" },
    { git: "git merge", trellis: "Three-way merge with semantic and CRDT-aware tooling" },
    { git: "Issues in another tool", trellis: "Issues, criteria, decisions, and references in-graph" },
    { git: "Lost experiments", trellis: "Idea Garden turns abandoned work into searchable clusters" },
  ];

  const scenarios = [
    {
      key: "apps",
      tab: "Live app",
      icon: "lucide:panels-top-left",
      eyebrow: "App backend",
      headline: "A note changes. State, query results, and UI subscribers move with it.",
      description:
        "The same write produces current state, durable history, and realtime updates for any interface already listening.",
      metricLabel: "Observed by",
      metricValue: "3 subscribers",
      action: "User pins a high-priority note in the sidebar",
      mutation: "entity:update",
      state: [
        { label: "Entity", value: 'note:7f3a • pinned=true • tags="ops,launch"' },
        { label: "Subscriber", value: 'useQuery("find Note where pinned = \\"true\\"") re-renders instantly' },
        { label: "Storage", value: "Append op, update entity, preserve prior values in the log" },
        { label: "Surface", value: "REST CRUD, EQL, uploads, auth, and WebSocket updates stay aligned" },
      ],
      query: 'find Note where pinned = "true"',
      results: [
        '{ id: "note:7f3a", title: "Launch brief", pinned: "true" }',
        '{ id: "note:21c9", title: "Customer escalations", pinned: "true" }',
      ],
      ops: [
        "[14:02:18] entity:update note:7f3a",
        "[14:02:18] query:notify pinned-notes",
        "[14:02:18] ws:broadcast subscriber#3",
      ],
      why: "The app does not need a separate cache invalidation story, audit story, and realtime story. They are the same write path.",
      outcomes: ["CRUD + query + subscriptions", "Embedded or remote mode", "Inspector-ready data surface"],
    },
    {
      key: "agents",
      tab: "Agent run",
      icon: "lucide:brain-circuit",
      eyebrow: "Agent runtime",
      headline: "An agent acts, and the why is captured alongside the write.",
      description:
        "Tool execution can emit decision traces with context, rationale, alternatives, and related entities instead of leaving that reasoning ephemeral.",
      metricLabel: "Captured",
      metricValue: "decision:DEC-42",
      action: "Renewal agent approves a service-impact exception",
      mutation: "decision:record",
      state: [
        { label: "Decision", value: "tool=approveDiscount • confidence=0.84 • precedent attached" },
        { label: "Entities", value: "account, incident, renewal, approver, and agent run stay linked" },
        { label: "Audit", value: "Input and output summaries are stored without blocking the tool response" },
        { label: "Surface", value: "MCP tools become a durable operational memory layer" },
      ],
      query: 'find Decision where toolName = "approveDiscount"',
      results: [
        '{ id: "decision:DEC-42", rationale: "SEV-1 precedent + finance exception" }',
        '{ id: "decision:DEC-39", rationale: "Matched prior enterprise renewal policy" }',
      ],
      ops: [
        "[09:14:02] tool:invoke approveDiscount",
        "[09:14:03] vcs:decisionRecord DEC-42",
        "[09:14:03] entity:update renewal:acme-q2",
      ],
      why: "This is the strongest non-VCS story in the repo: Trellis can become a system of record for decisions, not just objects.",
      outcomes: ["Searchable precedent", "Auditable autonomy", "Human-in-the-loop memory"],
    },
    {
      key: "code",
      tab: "Code workflow",
      icon: "lucide:git-compare-arrows",
      eyebrow: "Code workflow",
      headline: "A code change is more than a commit: it becomes structure, story, and recoverable exploration.",
      description:
        "You still get branches and milestones, but also issue state, semantic operations, and an idea garden for abandoned work.",
      metricLabel: "Recovered",
      metricValue: "cluster:garden-7",
      action: "Developer revives an abandoned auth refactor",
      mutation: "garden:revive",
      state: [
        { label: "Cluster", value: "auth/token-refresh + login/session files grouped as one exploration" },
        { label: "Branch", value: "feature/revive-auth-refresh created from preserved ops" },
        { label: "Issue", value: "TRL-18 remains linked to criteria, blockers, and working branch" },
        { label: "Merge", value: "Semantic and causal tools provide more context than a flat diff alone" },
      ],
      query: 'find Issue where status = "in_progress"',
      results: [
        '{ id: "TRL-18", title: "Revive auth refresh flow", branch: "feature/revive-auth-refresh" }',
      ],
      ops: [
        "[16:41:10] garden:search keyword=auth",
        "[16:41:12] branch:create feature/revive-auth-refresh",
        "[16:41:12] vcs:fileModify src/auth/session.ts",
      ],
      why: "Git is the bridge analogy, but the differentiator is that code changes, issues, references, and abandoned work all inhabit the same graph.",
      outcomes: ["Narrative milestones", "First-class issues", "Idea Garden revival"],
    },
  ] as const;

  type ScenarioKey = (typeof scenarios)[number]["key"];

  const activeScenario = ref<ScenarioKey>("apps");
  const activeScenarioData = computed(
    () => scenarios.find((scenario) => scenario.key === activeScenario.value) ?? scenarios[0],
  );
</script>
