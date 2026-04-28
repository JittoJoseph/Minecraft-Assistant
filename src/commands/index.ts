import type { CommandHandler } from "../types";
import afk from "./afk";
import autofarm from "./autofarm";
import come from "./come";
import farm from "./farm";
import follow from "./follow";
import help from "./help";
import setspawnpoint from "./setspawnpoint";
import sleep from "./sleep";
import stop from "./stop";
import unloadtochest from "./unloadtochest";

const commands: CommandHandler[] = [
  follow,
  come,
  afk,
  stop,
  farm,
  autofarm,
  setspawnpoint,
  sleep,
  unloadtochest,
  help,
];

export default commands;
