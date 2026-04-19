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

client.on('messageCreate', async (message) => {
    console.log(`📨 Message detected: ${message.content}`);

    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!leavepanel') {
        console.log('✅ Command triggered');

        const button = new ButtonBuilder()
            .setCustomId('leave_start')
            .setLabel('Leave Server')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(button);

        await message.channel.send({
            content: 'Click below to leave and give feedback:',
            components: [row]
        });

        console.log('✅ Button sent');
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    console.log('🔘 Interaction received');

    if (!interaction.isButton()) return;

    console.log(`🔘 Button clicked by ${interaction.user.tag}`);

    if (interaction.customId === 'leave_start') {
        await interaction.reply({
            content: 'Why are you leaving? Type your answer in chat.',
            ephemeral: true
        });

        console.log('📝 Waiting for response...');

        const filter = (m) => m.author.id === interaction.user.id;

        try {
            const collected = await interaction.channel.awaitMessages({
                filter,
                max: 1,
                time: 600000
            });

            if (!collected.size) {
                console.log('⚠️ No response received');
                return;
            }

            const response = collected.first().content;
            console.log(`📋 Response received: ${response}`);

            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

            await logChannel.send(
                `📋 **Exit Survey**\n` +
                `User: ${interaction.user.tag}\n` +
                `ID: ${interaction.user.id}\n\n` +
                `Response:\n${response}`
            );

            console.log('✅ Response sent to log channel');

            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.kick('Exit survey completed');

            console.log('🚪 User kicked successfully');
        } catch (err) {
            console.log('❌ ERROR:', err);
        }
    }
});

client.login(TOKEN);