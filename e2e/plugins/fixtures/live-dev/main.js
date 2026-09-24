// The e2e test replaces __VERSION__ to simulate saving a new build.
export default {
  __tesseraPlugin: 1,
  activate(api) {
    api.commands.register({ id: 'greet-__VERSION__', title: 'Greet (__VERSION__)', run() {} });
  },
};
