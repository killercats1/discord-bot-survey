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
const REQUIRED_ENV = ['TOKEN', 'CLIENT_ID'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`❌ Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
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

// ─── Health check server (required by Railway) ───────────────────────────────
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

// ─── Register slash commands ──────────────────────────────────────────────────
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

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('🔄 Registering slash commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Slash commands registered');
    } catch (err) {
        console.error('❌ Failed to register slash commands:', err);
    }
}

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    await registerCommands();
});

// ─── Interactions ─────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {

    // /setup command → save log channel for this server
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
        const channel = interaction.options.getChannel('channel');

        setLogChannel(interaction.guild.id, channel.id);

        const embed = new EmbedBuilder()
            .setTitle('✅ Setup Complete')
            .setDescription(`Exit survey logs will now be sent to ${channel}.`)
            .setColor(0x57F287);

        await interaction.reply({ embeds: [embed], ephemeral: true });
        console.log(`⚙️ Guild ${interaction.guild.name} set log channel to #${channel.name}`);
        return;
    }

    // /leavepanel slash command → post the button panel
    if (interaction.isChatInputCommand() && interaction.commandName === 'leavepanel') {

        // Warn if no log channel has been set up yet
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

        await interaction.reply({
            embeds: [embed],
            components: [row]
        });
        return;
    }

    // Leave button → open a modal
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

    // Modal submitted → log, confirm, kick
    if (interaction.isModalSubmit() && interaction.customId === 'leave_modal') {
        await interaction.deferReply({ flags: 64 });

        const reason = interaction.fields.getTextInputValue('leave_reason');
        const improve = interaction.fields.getTextInputValue('leave_improve') || '_No response_';
        const logChannelId = getLogChannel(interaction.guild.id);

        // Log to the designated channel
        try {
            if (!logChannelId) throw new Error('No log channel configured for this server');

            console.log(`📋 Attempting to log to channel: ${logChannelId}`);
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
            console.log('✅ Logged successfully');
        } catch (err) {
            console.error('❌ Failed to log:', err.message);
        }

        // Kick the user regardless of whether logging succeeded
        try {
            await interaction.editReply({
                content: '✅ Thanks for your feedback! You will now be removed from the server.'
            });

            await new Promise(r => setTimeout(r, 2000));

            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.kick('Exit survey completed');
            console.log(`🚪 Kicked ${interaction.user.tag}`);
        } catch (err) {
            console.error('❌ Failed to kick:', err.message);
            await interaction.editReply({
                content: '❌ Something went wrong. Please contact a server admin.'
            });
        }
    }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received — shutting down gracefully');
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received — shutting down gracefully');
    client.destroy();
    process.exit(0);
});

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(TOKEN);