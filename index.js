#!/usr/bin/env node

require('dotenv').config();
const os = require('os');
const inquirer = require('inquirer');
const express = require('express');
const app = express();
const path = require('path');
const open = require('open')
const querystring = require('query-string');
const axios = require('axios').default;
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const Table = require('cli-table');
const figlet = require('figlet');
const chalk = require("chalk");
const chalkAnimation = require('chalk-animation');
const spinner = require('ora')();
const cliSpinners = require('cli-spinners');
const puns = require("puns.dev");
const sleep = (ms = 2000) => new Promise((r) => setTimeout(r, ms));

const PORT = 8888;
const REDIRECT_URI = 'http://localhost:8888/callback';
const SCOPE = 'user-read-private playlist-read-private playlist-read-collaborative';

var playlists = [];
var accessToken = '';

setupServer();
welcome();

function setupServer() {
  app.listen(PORT);
  app.use('/', express.static(getDir() + '/views'));
  app.get('/callback', async (req, res) => handleCallback(req, res));
}

function getDir() {
  return path.join(require.main ? require.main.path : process.cwd());
}

async function handleCallback(req, res) {
  const code = req.query.code;
  stopSpinner();
  res.sendFile(getDir() + '/views/back_to_cli.html');

  if(code) {
    await handleCallbackSuccess(code);
  } else {
    await handleCallbackFailed();
  }
}

async function handleCallbackSuccess(code) {
    accessToken = await getAccessToken(code);
    playlists = await getPlaylists();
    await askForPlaylistAndDisplayTracks();
}

async function getAccessToken(code) {
  const queryData = {
      code: code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    };

  const response = await axios.create({
    baseURL: 'https://accounts.spotify.com/api',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
  }).post('/token', querystring.stringify(queryData));

  return response.data.access_token;
}

async function getPlaylists() {
  const response = await simpleGet('https://api.spotify.com/v1/me/playlists');
  var playlists = response.data.items;
  var nextUrl = response.data.next;

  while(nextUrl) {
    const nextResponse = await simpleGet(nextUrl)
    playlists = playlists.concat(nextResponse.data.items);
    nextUrl = nextResponse.data.next;
  }
  return playlists;
}

async function simpleGet(url) {
  return await axios.create({
    baseURL: url,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
  }).get();
}

async function askForPlaylistAndDisplayTracks() {
  const playlist = await askForPlaylist();

  startSpinner('Loading tracks of selected playlist');
  const tracks = await getPlaylistTracks(playlist);

  stopSpinner();
  displayTracks(tracks);
  askWhatsNext(playlist.name, tracks);
}

async function askForPlaylist() {
  const answer = await inquirer.prompt({
    name: 'selected_playlist',
    type: 'list',
    message: 'Noice! Now select a playlist:',
    choices: playlists.map(x => x.name)
  });

  return playlists.find(x => x.name == answer.selected_playlist);
}

async function getPlaylistTracks(playlist) {
  const response = await simpleGet(playlist.tracks.href)
  var tracks = response.data.items.map(x => x.track);
  var nextUrl = response.data.next;

  while(nextUrl) {
    const nextResponse = await simpleGet(nextUrl)
    tracks = tracks.concat(nextResponse.data.items.map(x => x.track));
    nextUrl = nextResponse.data.next;
  }
  return tracks.map(x => { 
    return {
      track: x.name,
      duration: msToTime(x.duration_ms),
      artist: x.artists[0].name,
      album: x.album.name,
      release_date: x.album.release_date,
      spotify_url: x.external_urls.spotify
    }
  });;
}

function msToTime(duration) {
  let seconds = parseInt((duration / 1000) % 60);
  let minutes = parseInt((duration / (1000*60)) % 60);
  let hours = parseInt((duration / (1000 * 60 * 60)) % 24);

  hours = hours < 10 ? "0" + hours : hours;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  seconds = seconds < 10 ? "0" + seconds : seconds;
  return hours + ":" + minutes + ":" + seconds;
}

function displayTracks(tracks) {
  var table = new Table({
    head: [chalk.green('Track'), chalk.green('Duration'), chalk.green('Artist'), chalk.green('Album'), chalk.green('Release-Date'), chalk.green('Spotify-Url')], 
    colWidths: [30, 12, 30, 30, 14, 60]
  });
  
  tracks.forEach(x => table.push([ x.track, x.duration, x.artist, x.album, x.release_date, x.spotify_url ]));
  console.log(table.toString() + '\n');
}

async function askWhatsNext(playlistName = null, tracks = null) {
  const choices = Array.of();
  const choiceExport = 'Export this playlist to disk';
  const choiceAnother = 'Let\'s look at another playlist';
  const choiceDone = 'Thanks, I\'m done';

  if(tracks) {
    choices.push(choiceExport);
  }
  choices.push(choiceAnother);
  choices.push(choiceDone);

  const answer = await inquirer.prompt({
    name: 'next',
    type: 'list',
    message: 'What\'s next?',
    choices: choices
  });

  if(answer.next == choiceExport) {
    exportTracksToCsv(playlistName, tracks);
  } else if(answer.next == choiceAnother) {
    console.log('\n');
    askForPlaylistAndDisplayTracks()
  } else {
    exit();
  }
}

async function exportTracksToCsv(playlistName, tracks) {
  startSpinner('Exporting playlist to disk..')
  await sleep(1000);

  const filePath = `${os.homedir()}/Downloads/${playlistName.replace('/', '_').replace(/\./g, '')}.csv`;
  const csvWriter = createCsvWriter({
    path: filePath,
    header: [
        {id: 'track', title: 'Track'},
        {id: 'duration', title: 'Duration'},
        {id: 'artist', title: 'Artist'},
        {id: 'album', title: 'Album'},
        {id: 'release_date', title: 'Release-Date'},
        {id: 'spotify_url', title: 'Spotify-Url'},
    ]
  });

  await csvWriter.writeRecords(tracks);
  stopSpinner();
  console.log(`  Boom! Your playlist was exported successfully, take a look at: ${filePath}\n`);
  askWhatsNext();
}

async function exit() {
  const pun = puns.random();
  console.log(`\n  Ok, before you leave, enjoy a joke!\n\n  ${pun.pun}\n  ${pun.punchline}\n\n  Byeee! 🍻\n`);
  await sleep(10000);
  process.exit(0);
}

async function handleCallbackFailed() {
  console.log('  Sorry, without the permissions there is not a lot I can do..\n');

  const answer = await inquirer.prompt({
    name: 'again',
    type: 'confirm',
    message: 'Try again?'
  });

  if(answer.again) {
    await authorizeSpotifyAccount();
  }
}

async function welcome() {
  await showTitle();
  console.log('\n  Welcome! To get started you\'ll need to grant spotify permissions so I can access your playlists.\n');

  const answer = await inquirer.prompt({
    name: 'welcome',
    type: 'confirm',
    message: 'Let\'s do it?!'
  });

  if(answer.welcome) {
    await authorizeSpotifyAccount();
  } else {
    exit();
  }
}

async function showTitle() {
  console.log('\n');
  const title = chalkAnimation.rainbow(figlet.textSync(' Playlist Extractor', { font: 'ANSI Shadow' }));
  await sleep(2500);
  title.stop();
}

async function authorizeSpotifyAccount() {
  await open('https://accounts.spotify.com/authorize?' +
      querystring.stringify({
        response_type: 'code',
        client_id: process.env.CLIENT_ID,
        scope: SCOPE,
        redirect_uri: REDIRECT_URI,
        show_dialog: false
      }));

  startSpinner('  Waiting for some action to happen at your browser..', true);
}

async function startSpinner(message, isFancy = false) {
  console.log('\n');

  if(isFancy) {
    spinner.prefixText = message;
    spinner.text = undefined;
    spinner.spinner = cliSpinners.pong;
  } else {
    spinner.text = message;
    spinner.prefixText = undefined;
    spinner.spinner = cliSpinners.dots;
  }

  spinner.color = 'green';
  spinner.start();
}

function stopSpinner() {
  spinner.stop();
}