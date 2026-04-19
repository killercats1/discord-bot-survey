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

// ✅ SIMPLE COMMAND (NO SLASH COMMANDS)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!leavepanel') {

        const button = new ButtonBuilder()
            .setCustomId('leave_start')
            .setLabel('Leave Server')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(button);

        await message.channel.send({
            content: "Click below to leave and give feedback:",
            components: [row]
        });
    }
});

// ✅ BUTTON HANDLER
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'leave_start') {

        await interaction.reply({
            content: "Why are you leaving? Type your answer in chat.",
            ephemeral: true
        });

        const filter = (m) => m.author.id === interaction.user.id;

        try {
            const collected = await interaction.channel.awaitMessages({
                filter,
                max: 1,
                time: 600000
            });

            if (!collected.size) return;

            const response = collected.first().content;

            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

            await logChannel.send(
                `📋 Exit Survey\nUser: ${interaction.user.tag}\nResponse:\n${response}`
            );

            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.kick("Exit survey completed");

        } catch (err) {
            console.log(err);
        }
    }
});

client.login(TOKEN);