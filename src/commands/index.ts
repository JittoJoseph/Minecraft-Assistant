import type { CommandHandler } from "../types";
import afk from "./afk";
import autofarm from "./autofarm";
import autosleep from "./autosleep";
import come from "./come";
import discordplayers from "./discordplayers";
import farm from "./farm";
import follow from "./follow";
import help from "./help";
import listitems from "./listitems";
import setspawnpoint from "./setspawnpoint";
import sleep from "./sleep";
import stop from "./stop";
import unloadinventory from "./unloadinventory";

const commands: CommandHandler[] = [
  follow,
  come,
  afk,
  stop,
  farm,
  autofarm,
  autosleep,
  discordplayers,
  listitems,
  setspawnpoint,
  sleep,
  unloadinventory,
  help,
];

export default commands;
