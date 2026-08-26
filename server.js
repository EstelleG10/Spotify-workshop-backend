const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

let spotifyToken = null;
let tokenExpiresAt = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < tokenExpiresAt) {
    return spotifyToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const response = await fetch(
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    }
  );

  if (!response.ok) {
    const message = await response.text();

    console.error(message);

    throw new Error("Spotify authentication failed");
  }

  const data = await response.json();

  spotifyToken = data.access_token;

  tokenExpiresAt =
    Date.now() +
    (data.expires_in - 60) * 1000;

  return spotifyToken;
}

app.get("/", function(req, res) {
  res.send("Spotify Workshop API is running 🎧");
});

app.get("/api/search", async function(req, res) {
  try {
    const query = req.query.q;

    if (!query) {
      return res.status(400).json({
        error: "Please enter a search term."
      });
    }

    const token = await getSpotifyToken();

    const params = new URLSearchParams({
      q: query,
      type: "track",
      market: "US",
      limit: "10"
    });

    const response = await fetch(
      "https://api.spotify.com/v1/search?" + params,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      const message = await response.text();

      console.error(message);

      return res.status(response.status).json({
        error: "Spotify search failed."
      });
    }

    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Something went wrong."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", function() {
  console.log(`Server running on port ${PORT}`);
});
