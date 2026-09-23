// Module declarations for the docs theme (VitePress compiles these files; tsc only checks types).
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module '*.css';
