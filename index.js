const {
    Client,
    GatewayIntentBits,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    EmbedBuilder
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const TOKEN = process.env.TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// 🎯 COMMAND
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!leavepanel') {

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("👋 Leaving so soon?")
            .setDescription(
                "We at **A Kings Hangout** are sad to see you go...\n\n" +
                "But before you leave, please use this to give feedback and help us improve in the future!"
            )
            .setFooter({ text: "Your feedback helps us grow 💙" });

        const button = new ButtonBuilder()
            .setCustomId('leave_start')
            .setLabel('Leave & Give Feedback')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(button);

        await message.channel.send({
            embeds: [embed],
            components: [row]
        });
    }
});

// 🔘 BUTTON SYSTEM
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'leave_start') {

        await interaction.reply({
            content: "📝 Tell us honestly — why are you leaving?",
            ephemeral: true
        });

        const filter = (m) => m.author.id === interaction.user.id;

        try {
            const collected = await interaction.channel.awaitMessages({
                filter,
                max: 1,
                time: 600000
            });

            if (!collected.size) {
                return interaction.followUp({
                    content: "⏰ You didn’t respond in time.",
                    ephemeral: true
                });
            }

            const response = collected.first().content;

            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

            const logEmbed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle("📋 Exit Survey Response")
                .addFields(
                    { name: "User", value: `${interaction.user.tag}`, inline: true },
                    { name: "User ID", value: `${interaction.user.id}`, inline: true },
                    { name: "Response", value: response }
                )
                .setTimestamp();

            await logChannel.send({ embeds: [logEmbed] });

            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.kick("Exit survey completed");

            await interaction.followUp({
                content: "💔 Thanks for your feedback. You have now left the server.",
                ephemeral: true
            });

        } catch (err) {
            console.log("❌ ERROR:", err);
        }
    }
});

client.login(TOKEN);