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
    SlashCommandBuilder
} = require('discord.js');

const http = require('http');

// ─── Validate environment variables on startup ───────────────────────────────
const REQUIRED_ENV = ['TOKEN', 'LOG_CHANNEL_ID', 'CLIENT_ID'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`❌ Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const TOKEN = process.env.TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;

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

    // /leavepanel slash command → post the button panel
    if (interaction.isChatInputCommand() && interaction.commandName === 'leavepanel') {
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

        // Log to the designated channel
        try {
            console.log(`📋 Attempting to log to channel: ${LOG_CHANNEL_ID}`);
            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

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
            console.error('❌ Failed to log — check LOG_CHANNEL_ID and permissions:', err.message);
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