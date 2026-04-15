const { Client, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const TOKEN = process.env.TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('guildMemberRemove', async (member) => {
    const user = member.user;

    try {
        const dm = await user.createDM();

        await dm.send(
            "Hey! We're sorry to see you go 😢\n\n" +
            "Would you mind telling us why you left?\n" +
            "Just reply to this message."
        );

        const filter = (msg) => msg.author.id === user.id;

        const collected = await dm.awaitMessages({
            filter,
            max: 1,
            time: 600000
        });

        if (!collected.size) return;

        const response = collected.first().content;

        const channel = await client.channels.fetch(LOG_CHANNEL_ID);

        await channel.send(
            `📋 **Exit Survey Response**\n` +
            `User: ${user.tag}\n` +
            `ID: ${user.id}\n\n` +
            `Response:\n${response}`
        );

    } catch (err) {
        console.log("Failed to DM user");

        try {
            const channel = await client.channels.fetch(LOG_CHANNEL_ID);

            await channel.send(
                `❌ **DM FAILED**\nUser: ${user.tag}\nID: ${user.id}`
            );
        } catch (e) {
            console.log("Also failed to log.");
        }
    }
});

client.login(TOKEN);