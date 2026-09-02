// Vinext calls process.exit(0) while Rolldown is closing native worker handles.
// Let Windows drain its event loop normally; failures retain their exit status.
if (process.platform === 'win32') {
  const exit = process.exit.bind(process);
  process.exit = (code) => {
    if (code === 0) {
      process.exitCode = 0;
      return;
    }
    return exit(code);
  };
}
process.argv = [process.execPath, 'vinext', 'build'];
await import(
  new URL('../node_modules/vinext/dist/cli.js', import.meta.url).href
);
