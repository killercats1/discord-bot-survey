const {
    Client,
    GatewayIntentBits,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    Events,
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType
} = require('discord.js');

const http = require('http');
const fs = require('fs');

// ─── Validate environment variables on startup ───────────────────────────────
const REQUIRED_ENV = ['TOKEN', 'CLIENT_ID', 'LOG_CHANNEL_ID'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`❌ Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const PING_USER_ID = '1221935327556407506';
const PORT = process.env.PORT || 3000;
const DATA_FILE = './data.json';

// ─── Per-guild data storage ───────────────────────────────────────────────────
function loadData() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getLogChannel(guildId) {
    const data = loadData();
    return data[guildId]?.logChannelId || null;
}

function setLogChannel(guildId, channelId) {
    const data = loadData();
    if (!data[guildId]) data[guildId] = {};
    data[guildId].logChannelId = channelId;
    saveData(data);
}

// ─── Discord logger ───────────────────────────────────────────────────────────
const logQueue = [];
let logReady = false;

async function discordLog(type, message, ping = false) {
    const entry = { type, message, timestamp: new Date(), ping };
    if (!logReady) {
        logQueue.push(entry);
        return;
    }
    await sendDiscordLog(entry);
}

async function sendDiscordLog({ type, message, timestamp, ping }) {
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        const colors = {
            info:    0x5865F2,
            success: 0x57F287,
            warning: 0xFEE75C,
            error:   0xED4245,
        };
        const icons = {
            info:    'ℹ️',
            success: '✅',
            warning: '⚠️',
            error:   '❌',
        };
        const embed = new EmbedBuilder()
            .setDescription(`${icons[type] || 'ℹ️'} ${message}`)
            .setColor(colors[type] || 0x5865F2)
            .setTimestamp(timestamp);

        await channel.send({
            content: ping ? `<@${PING_USER_ID}>` : undefined,
            embeds: [embed]
        });
    } catch (err) {
        console.error('Failed to send Discord log:', err.message);
    }
}

// ─── Health check server ──────────────────────────────────────────────────────
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(PORT, () => {
    console.log(`🌐 Health check server listening on port ${PORT}`);
});

// ─── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel]
});

// ─── Command definitions ──────────────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder()
        .setName('leavepanel')
        .setDescription('Post the leave server panel in this channel')
        .setDefaultMemberPermissions('8')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set the log channel for exit surveys')
        .setDefaultMemberPermissions('8')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('The channel to log exit surveys to')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .toJSON()
];

// ─── Register commands globally + for all current guilds ─────────────────────
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('🔄 Registering global slash commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Global slash commands registered');
        await discordLog('success', 'Global slash commands registered.');

        for (const guild of client.guilds.cache.values()) {
            await registerGuildCommands(guild.id, rest);
        }
    } catch (err) {
        console.error('❌ Failed to register commands:', err);
        await discordLog('error', `Failed to register commands: ${err.message}`, true);
    }
}

// ─── Register commands for a single guild (instant) ──────────────────────────
async function registerGuildCommands(guildId, existingRest) {
    const rest = existingRest || new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
        console.log(`✅ Commands registered for guild ${guildId}`);
    } catch (err) {
        console.error(`❌ Failed to register commands for guild ${guildId}:`, err.message);
    }
}

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    logReady = true;

    for (const entry of logQueue) {
        await sendDiscordLog(entry);
    }
    logQueue.length = 0;

    await discordLog('success', `Bot online — logged in as **${client.user.tag}** | In **${client.guilds.cache.size}** servers`);
    await registerCommands();
});

// ─── Register commands instantly when bot joins a new server ─────────────────
client.on(Events.GuildCreate, async (guild) => {
    console.log(`📥 Joined new guild: ${guild.name}`);
    await discordLog('info', `📥 Joined new server: **${guild.name}** (${guild.memberCount} members)`, true);
    await registerGuildCommands(guild.id);
});

// ─── Interactions ─────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {

    // /setup
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
        const channel = interaction.options.getChannel('channel');
        setLogChannel(interaction.guild.id, channel.id);

        const embed = new EmbedBuilder()
            .setTitle('✅ Setup Complete')
            .setDescription(`Exit survey logs will now be sent to ${channel}.`)
            .setColor(0x57F287);

        await interaction.reply({ embeds: [embed], ephemeral: true });
        await discordLog('info', `⚙️ **${interaction.guild.name}** set their log channel to <#${channel.id}>`);
        return;
    }

    // /leavepanel
    if (interaction.isChatInputCommand() && interaction.commandName === 'leavepanel') {
        const logChannelId = getLogChannel(interaction.guild.id);
        if (!logChannelId) {
            await interaction.reply({
                content: '⚠️ No log channel set! Run `/setup` first to choose where exit surveys are logged.',
                ephemeral: true
            });
            return;
        }

        const button = new ButtonBuilder()
            .setCustomId('leave_start')
            .setLabel('🚪 Leave Server')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(button);

        const embed = new EmbedBuilder()
            .setTitle('Leaving?')
            .setDescription("We're sorry to see you go. Click below to leave and share some quick feedback — it only takes a few seconds.")
            .setColor(0xED4245);

        await interaction.reply({ embeds: [embed], components: [row] });
        await discordLog('info', `📋 Leave panel posted in **${interaction.guild.name}** by ${interaction.user.tag}`);
        return;
    }

    // Leave button → modal
    if (interaction.isButton() && interaction.customId === 'leave_start') {
        const modal = new ModalBuilder()
            .setCustomId('leave_modal')
            .setTitle('Quick Exit Survey');

        const reasonInput = new TextInputBuilder()
            .setCustomId('leave_reason')
            .setLabel('Why are you leaving?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Be as honest as you like — this helps us improve.')
            .setRequired(true)
            .setMaxLength(1000);

        const improveInput = new TextInputBuilder()
            .setCustomId('leave_improve')
            .setLabel('What could we have done better?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Optional — any feedback is appreciated.')
            .setRequired(false)
            .setMaxLength(1000);

        modal.addComponents(
            new ActionRowBuilder().addComponents(reasonInput),
            new ActionRowBuilder().addComponents(improveInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // Modal submitted
    if (interaction.isModalSubmit() && interaction.customId === 'leave_modal') {
        await interaction.deferReply({ flags: 64 });

        const reason = interaction.fields.getTextInputValue('leave_reason');
        const improve = interaction.fields.getTextInputValue('leave_improve') || '_No response_';
        const logChannelId = getLogChannel(interaction.guild.id);

        // Log exit survey
        try {
            if (!logChannelId) throw new Error('No log channel configured for this server');

            const logChannel = await client.channels.fetch(logChannelId);
            const logEmbed = new EmbedBuilder()
                .setTitle('📋 Exit Survey')
                .setColor(0xFEE75C)
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: 'User', value: `${interaction.user.tag}`, inline: true },
                    { name: 'ID', value: `\`${interaction.user.id}\``, inline: true },
                    { name: 'Server', value: interaction.guild.name, inline: true },
                    { name: '❓ Why leaving?', value: reason },
                    { name: '💡 What could be better?', value: improve }
                )
                .setTimestamp();

            await logChannel.send({ embeds: [logEmbed] });
            console.log('✅ Exit survey logged');
        } catch (err) {
            console.error('❌ Failed to log exit survey:', err.message);
            await discordLog('error', `Failed to log exit survey in **${interaction.guild.name}**: ${err.message}`, true);
        }

        // Kick
        try {
            await interaction.editReply({
                content: '✅ Thanks for your feedback! You will now be removed from the server.'
            });

            await new Promise(r => setTimeout(r, 2000));

            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.kick('Exit survey completed');

            console.log(`🚪 Kicked ${interaction.user.tag} from ${interaction.guild.name}`);
            await discordLog('success', `🚪 **${interaction.user.tag}** was kicked from **${interaction.guild.name}**`, true);
        } catch (err) {
            console.error('❌ Failed to kick:', err.message);
            await discordLog('error', `Failed to kick **${interaction.user.tag}** from **${interaction.guild.name}**: ${err.message}`, true);
            await interaction.editReply({
                content: '❌ Something went wrong. Please contact a server admin.'
            });
        }
    }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down...');
    await discordLog('warning', 'Bot is shutting down (SIGTERM)', true);
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Shutting down...');
    await discordLog('warning', 'Bot is shutting down (SIGINT)', true);
    client.destroy();
    process.exit(0);
});

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(TOKEN);