// Public surface, for a project that wants to build on the parsing rather than
// shell out to the CLI.
export { loadConfig, problems, statuses, DEFAULTS, CONFIG_PATH } from './config.js';
export {
  frontmatter,
  readTask,
  readTasks,
  declaredFiles,
  matches,
  inScope,
  bookkeeping,
  setField,
} from './task.js';
