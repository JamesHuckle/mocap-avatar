function parseMajor(version) {
  const m = /^v?(\d+)/.exec(version);
  return m ? Number(m[1]) : null;
}

const major = parseMajor(process.versions.node);

if (major == null) {
  // eslint-disable-next-line no-console
  console.warn(`Warning: could not parse Node version: ${process.versions.node}`);
} else if (major < 18) {
  // eslint-disable-next-line no-console
  console.error(
    [
      `Unsupported Node.js version: ${process.versions.node}`,
      `Minimum supported Node.js version is 18.`,
      `Fix: install Node 20 (recommended) and re-run (see .nvmrc).`,
    ].join('\n'),
  );
  process.exit(1);
} else if (major !== 20) {
  // eslint-disable-next-line no-console
  console.warn(
    [
      `Warning: this repo is intended for Node 20 (see .nvmrc), but you're running ${process.versions.node}.`,
      `Dev may still work, but if you hit weird Next 12 / HMR issues, switch to Node 20.`,
    ].join('\n'),
  );
}

