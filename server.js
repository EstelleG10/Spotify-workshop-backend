const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

let spotifyToken = null;
let tokenExpiresAt = 0;

// ----------------------------------------
// CACHE + QUOTA PROTECTION
// ----------------------------------------

const searchCache = new Map();

// Keep search results for 1 hour
const CACHE_TIME = 60 * 60 * 1000;

// If Spotify says quota exceeded, stop making
// more Spotify requests for 10 minutes
let quotaBlockedUntil = 0;

// Prevent identical searches happening at
// exactly the same time from hitting Spotify twice
const pendingSearches = new Map();


// ----------------------------------------
// GET SPOTIFY ACCESS TOKEN
// ----------------------------------------

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < tokenExpiresAt) {
    return spotifyToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Spotify Client ID or Client Secret is missing."
    );
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const response = await fetch(
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    }
  );

  if (!response.ok) {
    const message = await response.text();

    console.error(
      "Spotify authentication error:",
      message
    );

    throw new Error(
      "Spotify authentication failed"
    );
  }

  const data = await response.json();

  spotifyToken = data.access_token;

  tokenExpiresAt =
    Date.now() +
    (data.expires_in - 60) * 1000;

  return spotifyToken;
}


// ----------------------------------------
// HOME PAGE
// ----------------------------------------

app.get("/", function(req, res) {
  res.send(
    "Spotify Workshop API is running 🎧"
  );
});


// ----------------------------------------
// SPOTIFY SEARCH
// ----------------------------------------

app.get("/api/search", async function(req, res) {
  try {
    const rawQuery = req.query.q;

    if (!rawQuery) {
      return res.status(400).json({
        error: "Please enter a search term."
      });
    }

    const query = rawQuery.trim();

    if (!query) {
      return res.status(400).json({
        error: "Please enter a search term."
      });
    }

    // Normalize so "Taylor Swift" and
    // "taylor swift" use the same cache entry
    const cacheKey = query.toLowerCase();

    // ----------------------------------------
    // CHECK CACHE FIRST
    // ----------------------------------------

    const cached = searchCache.get(cacheKey);

    if (
      cached &&
      Date.now() - cached.time < CACHE_TIME
    ) {
      console.log(
        `CACHE HIT: ${query}`
      );

      return res.json(cached.data);
    }


    // ----------------------------------------
    // STOP REQUESTS DURING QUOTA COOLDOWN
    // ----------------------------------------

    if (Date.now() < quotaBlockedUntil) {
      console.log(
        `Spotify quota cooldown - not requesting: ${query}`
      );

      return res.status(429).json({
        error:
          "Spotify is temporarily rate limited. Please try again later.",
        reason: "QUOTA_EXCEEDED"
      });
    }


    // ----------------------------------------
    // IF SAME SEARCH IS ALREADY RUNNING,
    // WAIT FOR THAT REQUEST INSTEAD
    // ----------------------------------------

    if (pendingSearches.has(cacheKey)) {
      console.log(
        `WAITING FOR EXISTING SEARCH: ${query}`
      );

      const data =
        await pendingSearches.get(cacheKey);

      return res.json(data);
    }


    // ----------------------------------------
    // CREATE SPOTIFY REQUEST
    // ----------------------------------------

    const searchPromise =
      performSpotifySearch(query);

    pendingSearches.set(
      cacheKey,
      searchPromise
    );

    try {
      const data = await searchPromise;

      // Save successful response
      searchCache.set(cacheKey, {
        data: data,
        time: Date.now()
      });

      console.log(
        `SPOTIFY SEARCH: ${query}`
      );

      return res.json(data);

    } finally {
      pendingSearches.delete(cacheKey);
    }

  } catch (error) {

    console.error(
      "Search error:",
      error.message
    );

    if (error.message === "SPOTIFY_QUOTA") {
      return res.status(429).json({
        error:
          "Spotify's request quota has been reached.",
        reason: "QUOTA_EXCEEDED"
      });
    }

    res.status(500).json({
      error: "Something went wrong."
    });
  }
});


// ----------------------------------------
// ACTUAL SPOTIFY SEARCH FUNCTION
// ----------------------------------------

async function performSpotifySearch(query) {

  const token =
    await getSpotifyToken();

  const params =
    new URLSearchParams({
      q: query,
      type: "track",
      market: "US",
      limit: "10"
    });

  const response = await fetch(
    "https://api.spotify.com/v1/search?" +
      params.toString(),
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );


  // ----------------------------------------
  // HANDLE 429 WITHOUT RETRYING
  // ----------------------------------------

  if (response.status === 429) {

    const message =
      await response.text();

    console.error(
      "Spotify 429:",
      message
    );

    // Stop requests for 10 minutes
    quotaBlockedUntil =
      Date.now() + 10 * 60 * 1000;

    throw new Error(
      "SPOTIFY_QUOTA"
    );
  }


  // ----------------------------------------
  // OTHER SPOTIFY ERRORS
  // ----------------------------------------

  if (!response.ok) {

    const message =
      await response.text();

    console.error(
      "Spotify search failed:",
      response.status,
      message
    );

    throw new Error(
      "Spotify search failed"
    );
  }


  return await response.json();
}


// ----------------------------------------
// START SERVER
// ----------------------------------------

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  "0.0.0.0",
  function() {
    console.log(
      `Server running on port ${PORT}`
    );
  }
);
