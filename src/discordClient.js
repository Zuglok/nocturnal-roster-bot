import { REST, Routes, Client, GatewayIntentBits, Partials } from "discord.js";
import { cfg, assertEnv } from "./config.js";
import { rosterCommandJSON, handleRosterInteraction } from "./roster.js";
import { backupSelftestCommandJSON, handleBackupSelftest } from "./backupSelftest.js";
import { attachBackups } from "./backups.js";

export async function registerCommands(mode = process.env.REGISTER_MODE || "guild") {
  assertEnv();
  const rest = new REST({ version: "10" }).setToken(cfg.discord.token);
  const appId = cfg.discord.appId;
  const guildId = cfg.discord.guildId;
  const body = [rosterCommandJSON, backupSelftestCommandJSON];

  try {
    if (mode === "guild-purge") {
      await rest.put(Routes.applicationCommands(appId), { body: [] });
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
      console.log("[Commands] Purged global+guild, registered guild commands");
    } else if (mode === "guild") {
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
      console.log("[Commands] Registered guild commands");
    } else if (mode === "global") {
      await rest.put(Routes.applicationCommands(appId), { body });
      console.log("[Commands] Registered global commands");
    } else {
      console.log(`[Commands] Unknown REGISTER_MODE='${mode}', skipped`);
    }
  } catch (e) {
    console.error("[Commands] Registration error:", e?.response?.data || e);
  }
}

export async function startBot() {
  assertEnv();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
	  GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`[Backups] Channel: ${process.env.DISCORD_CHANNEL_ID || "(unset)"} • Delay: ${process.env.ATTACHMENT_DELAY || "1000000"}ms`);
  });

  // Roster interactions
  client.on("interactionCreate", handleRosterInteraction);

  // Backup self-test command
  client.on("interactionCreate", handleBackupSelftest);

  // Backups (unchanged logic)
  attachBackups(client);

  await client.login(cfg.discord.token);
}
