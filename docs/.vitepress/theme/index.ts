import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import Screenshot from './Screenshot.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Screenshot', Screenshot);
  },
} satisfies Theme;
