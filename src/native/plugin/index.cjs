// Native ygl CLI extension. No separate database, tables, driver or background process.
exports.commands = {
  'retouch-native': { run: async (...args) => (await import('./commands.mjs')).run(...args) },
};
