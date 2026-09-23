<script setup lang="ts">
/**
 * A product screenshot from `assets/screenshots/<area>/<name>-{light,dark}.png`, matching the
 * docs theme. Screenshots are produced by each feature team; if one doesn't exist yet, the
 * figure hides itself instead of showing a broken image.
 */
import { withBase } from 'vitepress';
import { onMounted, ref } from 'vue';

const props = defineProps<{ name: string; alt: string; caption?: string }>();

const failed = ref(false);
const light = ref<HTMLImageElement | null>(null);

onMounted(() => {
  // The image may have failed before hydration attached the error handler.
  const image = light.value;
  if (image && image.complete && image.naturalWidth === 0) failed.value = true;
});

const src = (theme: 'light' | 'dark') => withBase(`/screenshots/${props.name}-${theme}.png`);
</script>

<template>
  <figure v-if="!failed" class="tess-screenshot">
    <img
      ref="light"
      class="tess-screenshot-light"
      :src="src('light')"
      :alt="alt"
      width="1440"
      height="900"
      loading="lazy"
      @error="failed = true"
    />
    <img
      class="tess-screenshot-dark"
      :src="src('dark')"
      :alt="alt"
      width="1440"
      height="900"
      loading="lazy"
      @error="failed = true"
    />
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
