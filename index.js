const {
    Client,
const {
    Client,
    GatewayIntentBits,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // 🔥 REGISTER SLASH COMMAND
    const commands = [
        new SlashCommandBuilder()
            .setName('leavepanel')
            .setDescription('Send the leave survey panel')
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
    );

    console.log("Slash command registered");
});

// 🔘 HANDLE COMMANDS + BUTTONS
client.on(Events.InteractionCreate, async (interaction) => {

    // 📌 SLASH COMMAND
    if (interaction.isChatInputCommand()) {

        if (interaction.commandName === 'leavepanel') {

            const button = new ButtonBuilder()
                .setCustomId('leave_start')
                .setLabel('Leave Server')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(button);

            await interaction.reply({
                content: "Thinking about leaving? Click below:",
                components: [row]
            });
        }
    }

    // 🔘 BUTTON CLICK
    if (interaction.isButton()) {

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
    }
});

client.login(TOKEN);