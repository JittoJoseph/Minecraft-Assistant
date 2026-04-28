import type { CommandHandler } from "../types";
import afk from "./afk";
import autofarm from "./autofarm";
import come from "./come";
import farm from "./farm";
import follow from "./follow";
import help from "./help";
import setspawnpoint from "./setspawnpoint";
import stop from "./stop";

const commands: CommandHandler[] = [
  follow,
  come,
  afk,
  stop,
  farm,
  autofarm,
  setspawnpoint,
  help,
];

export default commands;
