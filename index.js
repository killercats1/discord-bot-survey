const {
    Client,
    GatewayIntentBits,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const TOKEN = process.env.TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// 📌 COMMAND: !leavepanel
client.on('messageCreate', async (message) => {
    if (message.content === '!leavepanel') {

        const button = new ButtonBuilder()
            .setCustomId('leave_start')
            .setLabel('Leave Server')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(button);

        await message.channel.send({
            content: "Thinking about leaving? Click below to give feedback and leave:",
            components: [row]
        });
    }
});

// 🔘 BUTTON CLICK
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'leave_start') {
        await interaction.reply({
            content: "Why are you leaving? Type your answer below.",
            ephemeral: true
        });

        const filter = (m) => m.author.id === interaction.user.id;

        const collected = await interaction.channel.awaitMessages({
            filter,
            max: 1,
            time: 600000
        });

        if (!collected.size) return;

        const response = collected.first().content;

        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

        await logChannel.send(
            `📋 **Exit Survey**\n` +
            `User: ${interaction.user.tag}\n` +
            `ID: ${interaction.user.id}\n\n` +
            `Response:\n${response}`
        );

        // 💀 Kick user (they leave instantly)
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.kick("User completed exit survey");

        await interaction.followUp({
            content: "Thanks for your feedback. You have been removed from the server.",
            ephemeral: true
        });
    }
});

client.login(TOKEN);