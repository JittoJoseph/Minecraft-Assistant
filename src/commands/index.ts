import type { CommandHandler } from "../types";
import afk from "./afk";
import autofarm from "./autofarm";
import come from "./come";
import farm from "./farm";
import follow from "./follow";
import help from "./help";
import stop from "./stop";

const commands: CommandHandler[] = [
  follow,
  come,
  afk,
  stop,
  farm,
  autofarm,
  help,
];

export default commands;
