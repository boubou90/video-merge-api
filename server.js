const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");

const app = express();
app.use(express.json());

/* ================================= */
/* 🔎 HEALTH CHECK                   */
/* ================================= */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ================================= */
/* 🔎 FFMPEG TEST                    */
/* ================================= */
app.get("/ffmpeg-test", (req, res) => {
  exec("ffmpeg -version", (error, stdout) => {
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, output: stdout });
  });
});

/* ================================= */
/* 🎬 MERGE + MUSIC ENDPOINT         */
/* ================================= */
app.post("/merge", async (req, res) => {
  try {
    const { video1, video2, audio } = req.body;

    if (!video1 || !video2 || !audio) {
      return res.status(400).json({
        error: "video1, video2 and audio are required"
      });
    }

    const id = uuidv4();

    const video1Path = `/tmp/${id}_v1.mp4`;
    const video2Path = `/tmp/${id}_v2.mp4`;
    const audioPath = `/tmp/${id}_a.mp3`;
    const concatFile = `/tmp/${id}_concat.txt`;
    const mergedVideo = `/tmp/${id}_merged.mp4`;
    const finalOutput = `/tmp/${id}_final.mp4`;

    /* ------------------------------ */
    /* ⬇️ DOWNLOAD FUNCTION           */
    /* ------------------------------ */
    const download = async (url, filePath) => {
      const writer = fs.createWriteStream(filePath);
      const response = await axios({
        url,
        method: "GET",
        responseType: "stream"
      });

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
    };

    /* ------------------------------ */
    /* ⬇️ DOWNLOAD FILES              */
    /* ------------------------------ */
    await download(video1, video1Path);
    await download(video2, video2Path);
    await download(audio, audioPath);

    /* ------------------------------ */
    /* 📝 CREATE CONCAT FILE          */
    /* ------------------------------ */
    fs.writeFileSync(
      concatFile,
      `file '${video1Path}'\nfile '${video2Path}'`
    );

    /* ------------------------------ */
    /* 🎬 STEP 1 - MERGE VIDEOS       */
    /* (NO RE-ENCODE, LOW RAM)        */
    /* ------------------------------ */
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFile)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions(["-c copy"])
        .save(mergedVideo)
        .on("end", resolve)
        .on("error", reject);
    });

    /* ------------------------------ */
    /* 🎵 STEP 2 - ADD AUDIO          */
    /* ------------------------------ */
    
    ffmpeg()
  .input(mergedVideo)
  .input(audioPath)
  .outputOptions([
    "-map 0:v:0",
    "-map 1:a:0",
    "-shortest",
    "-c:v copy",
    "-c:a aac",
    "-b:a 128k",
    "-af loudnorm=I=-14:TP=-1.5:LRA=11"
  ])
  .save(finalOutput)
  .on("end", () => {

    const stream = fs.createReadStream(finalOutput);
    res.setHeader("Content-Type", "video/mp4");
    stream.pipe(res);

    stream.on("close", () => {
      [
        video1Path,
        video2Path,
        audioPath,
        concatFile,
        mergedVideo,
        finalOutput
      ].forEach(file => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      });
    });
  })
  .on("error", (err) => {
    console.error("FFmpeg error:", err);
    res.status(500).json({ error: err.message });
  });


/* ================================= */
/* 🚀 START SERVER                   */
/* ================================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
