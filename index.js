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
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

const http = require('http');
const fs = require('fs');

// ─── Validate environment variables ──────────────────────────────────────────
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
const PORT = process.env.PORT || 3000;
const DATA_FILE = './data.json';

// ─── In-memory captcha store (userId -> { code, guildId }) ───────────────────
const captchaStore = new Map();

// ─── Data storage ─────────────────────────────────────────────────────────────
function loadData() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { return {}; }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getGuildConfig(guildId) {
    return loadData()[guildId] || {};
}

function setGuildConfig(guildId, config) {
    const data = loadData();
    data[guildId] = { ...data[guildId], ...config };
    saveData(data);
}

// ─── Discord logger ───────────────────────────────────────────────────────────
const logQueue = [];
let logReady = false;

async function discordLog(type, message) {
    const entry = { type, message, timestamp: new Date() };
    if (!logReady) { logQueue.push(entry); return; }
    await sendDiscordLog(entry);
}

async function sendDiscordLog({ type, message, timestamp }) {
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        const colors = { info: 0x5865F2, success: 0x57F287, warning: 0xFEE75C, error: 0xED4245 };
        const icons  = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
        const embed = new EmbedBuilder()
            .setDescription(`${icons[type] || 'ℹ️'} ${message}`)
            .setColor(colors[type] || 0x5865F2)
            .setTimestamp(timestamp);
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Failed to send Discord log:', err.message);
    }
}

// ─── Captcha generator ────────────────────────────────────────────────────────
function generateCaptcha() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// ─── Health check server ──────────────────────────────────────────────────────
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(PORT, () => console.log(`🌐 Health check server listening on port ${PORT}`));

// ─── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel]
});

// ─── Commands ─────────────────────────────────────────────────────────────────
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
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('The channel to log exit surveys to')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .toJSON(),

    new SlashCommandBuilder()
        .setName('runversetup')
        .setDescription('Set up the verification system for this server')
        .setDefaultMemberPermissions('8')
        .addStringOption(o => o
            .setName('type')
            .setDescription('Which verification type to use')
            .setRequired(true)
            .addChoices(
                { name: '📋 Survey (1-2 questions)', value: 'survey' },
                { name: '🔒 Captcha (type the code)', value: 'captcha' }
            ))
        .addRoleOption(o => o
            .setName('role')
            .setDescription('Role to give users after verifying')
            .setRequired(true))
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('Channel to post the verification panel in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .toJSON(),
];

// ─── Register commands ────────────────────────────────────────────────────────
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('🔄 Registering slash commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        for (const guild of client.guilds.cache.values()) {
            await registerGuildCommands(guild.id, rest);
        }
        console.log('✅ Commands registered');
        await discordLog('success', 'Slash commands registered successfully.');
    } catch (err) {
        console.error('❌ Failed to register commands:', err);
        await discordLog('error', `Failed to register commands: ${err.message}`);
    }
}

async function registerGuildCommands(guildId, existingRest) {
    const rest = existingRest || new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
    } catch (err) {
        console.error(`❌ Failed to register commands for guild ${guildId}:`, err.message);
    }
}

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    logReady = true;
    for (const entry of logQueue) await sendDiscordLog(entry);
    logQueue.length = 0;
    await discordLog('success', `Bot online — **${client.user.tag}** | In **${client.guilds.cache.size}** servers`);
    await registerCommands();
});

client.on(Events.GuildCreate, async (guild) => {
    await discordLog('info', `📥 Joined new server: **${guild.name}** (${guild.memberCount} members)`);
    await registerGuildCommands(guild.id);
});

// ─── Interactions ─────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {

    // ── /setup ────────────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
        const channel = interaction.options.getChannel('channel');
        setGuildConfig(interaction.guild.id, { logChannelId: channel.id });

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('✅ Setup Complete')
                .setDescription(`Exit survey logs will now be sent to ${channel}.`)
                .setColor(0x57F287)],
            ephemeral: true
        });
        await discordLog('info', `⚙️ **${interaction.guild.name}** set log channel to <#${channel.id}>`);
        return;
    }

    // ── /runversetup ──────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'runversetup') {
        const type    = interaction.options.getString('type');
        const role    = interaction.options.getRole('role');
        const channel = interaction.options.getChannel('channel');

        setGuildConfig(interaction.guild.id, {
            verification: { type, roleId: role.id, channelId: channel.id }
        });

        // Build the verification panel embed + button
        const isSurvey = type === 'survey';

        const panelEmbed = new EmbedBuilder()
            .setTitle(isSurvey ? '📋 Verify to join!' : '🔒 Verify to join!')
            .setDescription(isSurvey
                ? `Welcome! To gain access to the server, click the button below and answer a couple of quick questions.`
                : `Welcome! To gain access to the server, click the button below and enter the captcha code you'll be given.`)
            .setColor(0x5865F2)
            .setFooter({ text: `Verification type: ${isSurvey ? 'Survey' : 'Captcha'}` });

        const verifyButton = new ButtonBuilder()
            .setCustomId(`verify_start_${type}`)
            .setLabel(isSurvey ? '📋 Start Survey' : '🔒 Get Captcha')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(verifyButton);

        // Post panel in the chosen channel
        const verChannel = await client.channels.fetch(channel.id);
        await verChannel.send({ embeds: [panelEmbed], components: [row] });

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('✅ Verification Setup Complete')
                .addFields(
                    { name: 'Type', value: isSurvey ? '📋 Survey' : '🔒 Captcha', inline: true },
                    { name: 'Role', value: `<@&${role.id}>`, inline: true },
                    { name: 'Channel', value: `<#${channel.id}>`, inline: true }
                )
                .setColor(0x57F287)],
            ephemeral: true
        });

        await discordLog('info', `🔐 **${interaction.guild.name}** set up **${type}** verification → role <@&${role.id}>`);
        return;
    }

    // ── /leavepanel ───────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'leavepanel') {
        const config = getGuildConfig(interaction.guild.id);
        if (!config.logChannelId) {
            await interaction.reply({
                content: '⚠️ No log channel set! Run `/setup` first.',
                ephemeral: true
            });
            return;
        }

        const button = new ButtonBuilder()
            .setCustomId('leave_start')
            .setLabel('🚪 Leave Server')
            .setStyle(ButtonStyle.Danger);

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Leaving?')
                .setDescription("We're sorry to see you go. Click below to leave and share some quick feedback.")
                .setColor(0xED4245)],
            components: [new ActionRowBuilder().addComponents(button)]
        });
        return;
    }

    // ── Verify button: Survey ─────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'verify_start_survey') {
        const modal = new ModalBuilder()
            .setCustomId('verify_modal_survey')
            .setTitle('Server Verification');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('survey_q1')
                    .setLabel('How did you find our server?')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. A friend, Reddit, Discord discovery...')
                    .setRequired(true)
                    .setMaxLength(200)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('survey_q2')
                    .setLabel('Do you agree to follow the server rules?')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Yes / No')
                    .setRequired(true)
                    .setMaxLength(100)
            )
        );

        await interaction.showModal(modal);
        return;
    }

    // ── Verify button: Captcha ────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'verify_start_captcha') {
        const code = generateCaptcha();
        captchaStore.set(interaction.user.id, { code, guildId: interaction.guild.id });

        // Auto-expire captcha after 5 minutes
        setTimeout(() => captchaStore.delete(interaction.user.id), 300000);

        // Show captcha code ephemerally, then open modal
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('🔒 Your Captcha Code')
                .setDescription(`Enter this code in the next step:\n\n# \`${code}\``)
                .setColor(0x5865F2)
                .setFooter({ text: 'This code expires in 5 minutes' })],
            ephemeral: true
        });

        // Follow up with a button to open the input modal
        const enterButton = new ButtonBuilder()
            .setCustomId('verify_captcha_enter')
            .setLabel('Enter Code')
            .setStyle(ButtonStyle.Primary);

        await interaction.followUp({
            content: 'Click below to enter your captcha code:',
            components: [new ActionRowBuilder().addComponents(enterButton)],
            ephemeral: true
        });
        return;
    }

    // ── Captcha entry button ──────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'verify_captcha_enter') {
        const modal = new ModalBuilder()
            .setCustomId('verify_modal_captcha')
            .setTitle('Enter Captcha Code');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('captcha_input')
                    .setLabel('Enter the code shown above')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. A3BX9K')
                    .setRequired(true)
                    .setMaxLength(6)
            )
        );

        await interaction.showModal(modal);
        return;
    }

    // ── Survey modal submitted ────────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal_survey') {
        await interaction.deferReply({ flags: 64 });

        const q1 = interaction.fields.getTextInputValue('survey_q1');
        const q2 = interaction.fields.getTextInputValue('survey_q2');
        const config = getGuildConfig(interaction.guild.id);

        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.add(config.verification.roleId);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Verified!')
                    .setDescription('You now have access to the server. Welcome!')
                    .setColor(0x57F287)]
            });

            await discordLog('success',
                `✅ **${interaction.user.tag}** verified in **${interaction.guild.name}** (Survey)\n` +
                `> How they found us: ${q1}\n> Agreed to rules: ${q2}`
            );
        } catch (err) {
            console.error('❌ Failed to give role:', err.message);
            await interaction.editReply({ content: '❌ Something went wrong. Please contact an admin.' });
            await discordLog('error', `Failed to verify ${interaction.user.tag} in **${interaction.guild.name}**: ${err.message}`);
        }
        return;
    }

    // ── Captcha modal submitted ───────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal_captcha') {
        await interaction.deferReply({ flags: 64 });

        const input = interaction.fields.getTextInputValue('captcha_input').toUpperCase().trim();
        const stored = captchaStore.get(interaction.user.id);

        if (!stored) {
            await interaction.editReply({ content: '⏱️ Your captcha expired. Click the button again to get a new one.' });
            return;
        }

        if (input !== stored.code) {
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Incorrect Code')
                    .setDescription('That code was wrong. Click the verify button again to get a new captcha.')
                    .setColor(0xED4245)]
            });
            captchaStore.delete(interaction.user.id);
            await discordLog('warning', `⚠️ **${interaction.user.tag}** failed captcha in **${interaction.guild.name}**`);
            return;
        }

        // Correct!
        captchaStore.delete(interaction.user.id);
        const config = getGuildConfig(interaction.guild.id);

        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.add(config.verification.roleId);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Verified!')
                    .setDescription('Captcha passed! You now have access to the server. Welcome!')
                    .setColor(0x57F287)]
            });

            await discordLog('success', `✅ **${interaction.user.tag}** verified in **${interaction.guild.name}** (Captcha)`);
        } catch (err) {
            console.error('❌ Failed to give role:', err.message);
            await interaction.editReply({ content: '❌ Something went wrong. Please contact an admin.' });
            await discordLog('error', `Failed to verify ${interaction.user.tag} in **${interaction.guild.name}**: ${err.message}`);
        }
        return;
    }

    // ── Leave button ──────────────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'leave_start') {
        const modal = new ModalBuilder()
            .setCustomId('leave_modal')
            .setTitle('Quick Exit Survey');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('leave_reason')
                    .setLabel('Why are you leaving?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Be as honest as you like — this helps us improve.')
                    .setRequired(true)
                    .setMaxLength(1000)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('leave_improve')
                    .setLabel('What could we have done better?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Optional — any feedback is appreciated.')
                    .setRequired(false)
                    .setMaxLength(1000)
            )
        );

        await interaction.showModal(modal);
        return;
    }

    // ── Leave modal submitted ─────────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'leave_modal') {
        await interaction.deferReply({ flags: 64 });

        const reason  = interaction.fields.getTextInputValue('leave_reason');
        const improve = interaction.fields.getTextInputValue('leave_improve') || '_No response_';
        const config  = getGuildConfig(interaction.guild.id);

        // Log exit survey
        try {
            if (!config.logChannelId) throw new Error('No log channel configured');
            const logChannel = await client.channels.fetch(config.logChannelId);
            await logChannel.send({
                embeds: [new EmbedBuilder()
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
                    .setTimestamp()]
            });
        } catch (err) {
            console.error('❌ Failed to log exit survey:', err.message);
            await discordLog('error', `Failed to log exit survey in **${interaction.guild.name}**: ${err.message}`);
        }

        // Kick
        try {
            await interaction.editReply({ content: '✅ Thanks for your feedback! You will now be removed from the server.' });
            await new Promise(r => setTimeout(r, 2000));
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.kick('Exit survey completed');
            await discordLog('success', `🚪 **${interaction.user.tag}** left **${interaction.guild.name}**`);
        } catch (err) {
            console.error('❌ Failed to kick:', err.message);
            await discordLog('error', `Failed to kick **${interaction.user.tag}** from **${interaction.guild.name}**: ${err.message}`);
            await interaction.editReply({ content: '❌ Something went wrong. Please contact a server admin.' });
        }
    }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
    await discordLog('warning', 'Bot is shutting down (SIGTERM)');
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await discordLog('warning', 'Bot is shutting down (SIGINT)');
    client.destroy();
    process.exit(0);
});

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(TOKEN);