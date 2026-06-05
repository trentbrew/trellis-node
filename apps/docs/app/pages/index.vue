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
            Stop losing context between your AI and your code.
          </h1>

          <p class="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
            Trellis Studio is a local-first workspace where code, agents, decisions, and history
            live in one graph. One command. No signup. Your machine owns the data.
          </p>

          <div class="mt-10 flex flex-wrap items-center gap-4">
            <UiButton size="lg" as="a" href="/studio/introduction">
              Try Trellis Studio
              <Icon name="lucide:arrow-right" class="ml-1 size-4" />
            </UiButton>
            <UiButton size="lg" variant="outline" as="a" href="/getting-started/introduction">
              Read the docs
            </UiButton>
            <UiButton
              size="lg"
              variant="ghost"
              as="a"
              href="https://github.com/trentbrew/trellis"
              target="_blank"
            >
              <Icon name="radix-icons:github-logo" class="mr-1 size-4" />
              GitHub
            </UiButton>
          </div>

          <div class="mt-8 max-w-md rounded-lg border border-border/60 bg-background/60 p-4 backdrop-blur-sm">
            <div class="flex items-center gap-3 font-mono text-sm">
              <span class="select-none text-muted-foreground">$</span>
              <span>npx trellis studio</span>
              <button
                class="ml-auto text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Copy install command"
                @click="copyInstall"
              >
                <Icon :name="copied ? 'lucide:check' : 'lucide:copy'" class="size-4" />
              </button>
            </div>
            <p class="mt-2 text-xs text-muted-foreground">
              Requires Node 18+ and git. Also available as
              <code class="font-mono">npm install -g trellis</code> for CLI-only use.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Three pillars -->
    <section class="border-b border-border/30 py-20 lg:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-12 max-w-3xl">
          <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Why teams switch
          </p>
          <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            One graph instead of five disconnected tools
          </h2>
          <p class="mt-4 text-lg text-muted-foreground">
            Cursor, Notion, GitHub Issues, and agent chat each hold a fragment of your project.
            Trellis keeps them in one inspectable substrate.
          </p>
        </div>

        <div class="grid gap-6 md:grid-cols-3">
          <div
            v-for="pillar in pillars"
            :key="pillar.title"
            class="rounded-lg border border-border/50 p-6"
          >
            <div class="flex size-10 items-center justify-center rounded-md border border-border/50">
              <Icon :name="pillar.icon" class="size-5 text-muted-foreground" />
            </div>
            <h3 class="mt-4 text-lg font-semibold">{{ pillar.title }}</h3>
            <p class="mt-3 text-sm leading-7 text-muted-foreground">
              {{ pillar.description }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Interactive demo -->
    <section class="border-b border-border/30 py-20 lg:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-8 max-w-3xl">
          <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            See it work
          </p>
          <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            One mutation, four artifacts
          </h2>
          <p class="mt-4 text-lg text-muted-foreground">
            Pick a surface and see what a single write produces in the graph.
          </p>
        </div>

        <div class="mb-6 flex flex-wrap gap-2">
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
                  <div
                    class="hidden rounded-md border border-border/50 px-3 py-2 text-right text-xs text-muted-foreground sm:block"
                  >
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
                      <span
                        class="rounded-md border border-border/60 px-2 py-1 font-mono text-xs text-muted-foreground"
                      >
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
                      <span
                        class="rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-muted-foreground"
                      >
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

        <p class="mt-6 text-sm text-muted-foreground">
          Familiar with Git?
          <a href="/getting-started/introduction" class="font-medium text-foreground hover:underline">
            See how Trellis compares
          </a>
          in the introduction docs.
        </p>
      </div>
    </section>

    <!-- Founder -->
    <section class="border-b border-border/30 py-20 lg:py-24">
      <div class="mx-auto max-w-3xl px-6">
        <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Why I built this
        </p>
        <blockquote class="mt-6 text-lg leading-8 text-foreground">
          I kept re-explaining the same project context to every new agent session. Decisions lived
          in Slack, tasks in GitHub, notes in Notion, and the reasoning behind changes disappeared
          into chat logs. Trellis is the graph I wanted: local, inspectable, and shared between
          humans and agents.
        </blockquote>
        <p class="mt-4 text-sm text-muted-foreground">
          Trent Brew,
          <a
            href="https://brew.build/posts/trellis-studio"
            target="_blank"
            class="font-medium text-foreground hover:underline"
          >
            A Polite Lie Told to Gravity
          </a>
        </p>
      </div>
    </section>

    <!-- FAQ -->
    <section class="border-b border-border/30 py-20 lg:py-24">
      <div class="mx-auto max-w-3xl px-6">
        <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">FAQ</p>
        <h2 class="mt-3 text-3xl font-bold tracking-tight">Common questions</h2>

        <dl class="mt-10 space-y-8">
          <div v-for="item in faqs" :key="item.question">
            <dt class="text-base font-semibold">{{ item.question }}</dt>
            <dd class="mt-2 text-sm leading-7 text-muted-foreground">{{ item.answer }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- CTA -->
    <section class="py-20 lg:py-24">
      <div class="mx-auto max-w-4xl px-6 text-center">
        <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Start here
        </p>
        <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Your project, one graph, under your control
        </h2>
        <p class="mt-4 text-lg leading-8 text-muted-foreground">
          Open Trellis Studio locally in under a minute. No account required.
        </p>
        <div class="mt-10 flex flex-wrap items-center justify-center gap-4">
          <UiButton size="lg" as="a" href="/studio/introduction">
            Try Trellis Studio
          </UiButton>
          <UiButton size="lg" variant="outline" as="a" href="/getting-started/quick-start">
            Quick start guide
          </UiButton>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-border/30 py-8">
      <div
        class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-muted-foreground"
      >
        <div class="flex items-center gap-2">
          <img src="/logo.svg" alt="Trellis" class="size-4 opacity-60 invert dark:invert-0" />
          <span>trellis</span>
        </div>
        <div class="flex items-center gap-6">
          <a
            href="https://github.com/trentbrew/trellis"
            target="_blank"
            class="transition-colors hover:text-foreground"
            >GitHub</a
          >
          <a
            href="https://www.npmjs.com/package/trellis"
            target="_blank"
            class="transition-colors hover:text-foreground"
            >npm</a
          >
          <a href="/studio/introduction" class="transition-colors hover:text-foreground">Studio</a>
          <a href="/getting-started/introduction" class="transition-colors hover:text-foreground"
            >Docs</a
          >
          <span
            >Built by
            <a href="https://turtle.tech" target="_blank" class="transition-colors hover:text-foreground"
              >turtle.tech</a
            ></span
          >
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
    await navigator.clipboard.writeText("npx trellis studio");
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  };

  const pillars = [
    {
      icon: "lucide:waypoints",
      title: "Everything links to everything",
      description:
        "Code, issues, decisions, and agent runs share one graph. No more copy-pasting context between Cursor, Notion, and GitHub.",
    },
    {
      icon: "lucide:file-stack",
      title: "Agent decisions you can audit",
      description:
        "Every tool call and rationale becomes a searchable record. Precedent accumulates instead of disappearing into chat logs.",
    },
    {
      icon: "lucide:hard-drive",
      title: "Local-first by default",
      description:
        "Your graph lives on your machine. Cloud is optional. Open Studio with one command and keep building without a signup flow.",
    },
  ];

  const faqs = [
    {
      question: "Is Trellis replacing Git?",
      answer:
        "Not necessarily. Trellis adds a causal graph for code, issues, decisions, and agent memory. Many teams use it alongside Git during the transition. The introduction docs include a Git comparison table.",
    },
    {
      question: "Do I need the cloud?",
      answer:
        "No. Trellis Studio runs locally with npx trellis studio. Hosted workspaces at studio.trellis.computer are optional for teams that want a browser sandbox.",
    },
    {
      question: "How is this different from Cursor or Windsurf?",
      answer:
        "Those are editors with AI built in. Trellis is the project graph underneath: durable agent memory, decision traces, issues, and history in one substrate your agents can query.",
    },
    {
      question: "Who is this for?",
      answer:
        "Developer-led teams (1–10 people) building with AI agents who feel context fragmentation across their editor, issue tracker, and chat tools.",
    },
  ];

  const scenarios = [
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
        {
          label: "Entities",
          value: "account, incident, renewal, approver, and agent run stay linked",
        },
        {
          label: "Audit",
          value: "Input and output summaries are stored without blocking the tool response",
        },
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
      why: "This is the strongest story in Trellis: a system of record for decisions, not just objects.",
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
        {
          label: "Cluster",
          value: "auth/token-refresh + login/session files grouped as one exploration",
        },
        { label: "Branch", value: "feature/revive-auth-refresh created from preserved ops" },
        { label: "Issue", value: "TRL-18 remains linked to criteria, blockers, and working branch" },
        {
          label: "Merge",
          value: "Semantic and causal tools provide more context than a flat diff alone",
        },
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
      why: "Code changes, issues, references, and abandoned work all inhabit the same graph.",
      outcomes: ["Narrative milestones", "First-class issues", "Idea Garden revival"],
    },
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
        {
          label: "Subscriber",
          value: 'useQuery("find Note where pinned = \\"true\\"") re-renders instantly',
        },
        { label: "Storage", value: "Append op, update entity, preserve prior values in the log" },
        {
          label: "Surface",
          value: "REST CRUD, EQL, uploads, auth, and WebSocket updates stay aligned",
        },
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
      why: "The app does not need separate cache invalidation, audit, and realtime stories. They are the same write path.",
      outcomes: ["CRUD + query + subscriptions", "Embedded or remote mode", "Inspector-ready data"],
    },
  ] as const;

  type ScenarioKey = (typeof scenarios)[number]["key"];

  const activeScenario = ref<ScenarioKey>("agents");
  const activeScenarioData = computed(
    () => scenarios.find((scenario) => scenario.key === activeScenario.value) ?? scenarios[0],
  );
</script>
