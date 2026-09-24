// node:sqlite (and Web Crypto, used by SimpleWebAuthn) may print ExperimentalWarnings
// on some Node 24 minors. Drop just those; every other warning still prints.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const text = typeof warning === 'string' ? warning : warning?.message;
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  if ((type === 'ExperimentalWarning' || warning?.name === 'ExperimentalWarning') && /SQLite|Web Crypto/i.test(text ?? '')) return;
  return emitWarning(warning, ...args);
};
