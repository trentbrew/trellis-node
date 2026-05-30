<template>
  <div ref="containerRef" class="size-full" :class="normalizeClass(props.class) || undefined">
    <canvas
      ref="canvasRef"
      class="pointer-events-none"
      :style="{
        width: `${canvasSize.width}px`,
        height: `${canvasSize.height}px`,
      }"
    />
  </div>
</template>

<script lang="ts" setup>
  import { normalizeClass } from "vue";
  import type { HTMLAttributes } from "vue";

  const props = withDefaults(
    defineProps<{
      squareSize?: number;
      gridGap?: number;
      flickerChance?: number;
      color?: string;
      width?: number;
      height?: number;
      class?: HTMLAttributes["class"];
      maxOpacity?: number;
    }>(),
    {
      squareSize: 4,
      gridGap: 6,
      flickerChance: 0.3,
      color: "rgb(0, 0, 0)",
      maxOpacity: 0.2,
    },
  );

  const canvasRef = ref<HTMLCanvasElement | null>(null);
  const containerRef = ref<HTMLDivElement | null>(null);
  const isInView = ref(false);
  const canvasSize = ref({ width: 0, height: 0 });

  type GridParams = {
    cols: number;
    rows: number;
    squares: Float32Array;
    dpr: number;
  };

  let gridParams: GridParams | null = null;
  let animationFrameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;

  const memoizedColor = computed(() => {
    const color = props.color;
    if (import.meta.server) return "rgba(0, 0, 0,";
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "rgba(0, 0, 0,";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    return `rgba(${r}, ${g}, ${b},`;
  });

  function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number): GridParams {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const cols = Math.ceil(width / (props.squareSize + props.gridGap));
    const rows = Math.ceil(height / (props.squareSize + props.gridGap));
    const squares = new Float32Array(cols * rows);
    for (let i = 0; i < squares.length; i++) {
      squares[i] = Math.random() * props.maxOpacity;
    }
    return { cols, rows, squares, dpr };
  }

  function updateSquares(squares: Float32Array, deltaTime: number) {
    for (let i = 0; i < squares.length; i++) {
      if (Math.random() < props.flickerChance * deltaTime) {
        squares[i] = Math.random() * props.maxOpacity;
      }
    }
  }

  function drawGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cols: number,
    rows: number,
    squares: Float32Array,
    dpr: number,
  ) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "transparent";
    ctx.fillRect(0, 0, width, height);
    const rgba = memoizedColor.value;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const opacity = squares[i * rows + j];
        ctx.fillStyle = `${rgba}${opacity})`;
        ctx.fillRect(
          i * (props.squareSize + props.gridGap) * dpr,
          j * (props.squareSize + props.gridGap) * dpr,
          props.squareSize * dpr,
          props.squareSize * dpr,
        );
      }
    }
  }

  function updateCanvasSize() {
    const canvas = canvasRef.value;
    const container = containerRef.value;
    if (!canvas || !container) return;
    const newWidth = props.width ?? container.clientWidth;
    const newHeight = props.height ?? container.clientHeight;
    canvasSize.value = { width: newWidth, height: newHeight };
    gridParams = setupCanvas(canvas, newWidth, newHeight);
  }

  let lastTime = 0;

  function animate(time: number) {
    const canvas = canvasRef.value;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!isInView.value || !gridParams || !canvas || !ctx) return;

    const deltaTime = (time - lastTime) / 1000;
    lastTime = time;

    updateSquares(gridParams.squares, deltaTime);
    drawGrid(
      ctx,
      canvas.width,
      canvas.height,
      gridParams.cols,
      gridParams.rows,
      gridParams.squares,
      gridParams.dpr,
    );
    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (animationFrameId !== null) return;
    lastTime = 0;
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function init() {
    const canvas = canvasRef.value;
    const container = containerRef.value;
    if (!canvas || !container) return;

    updateCanvasSize();

    resizeObserver = new ResizeObserver(() => updateCanvasSize());
    resizeObserver.observe(container);

    intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isInView.value = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(canvas);
  }

  function destroy() {
    stopAnimation();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    resizeObserver = null;
    intersectionObserver = null;
    gridParams = null;
  }

  watch(isInView, (visible) => {
    if (visible) startAnimation();
    else stopAnimation();
  });

  watch(
    () => [props.squareSize, props.gridGap, props.maxOpacity, props.color],
    () => {
      updateCanvasSize();
    },
  );

  onMounted(() => {
    init();
    if (isInView.value) startAnimation();
  });

  onUnmounted(() => destroy());
</script>
