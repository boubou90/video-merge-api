const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");

const app = express();
app.use(express.json());

/* 🔎 TEST FFMPEG */
app.get("/ffmpeg-test", (req, res) => {
  exec("ffmpeg -version", (error, stdout, stderr) => {
    if (error) {
      return res.json({
        success: false,
        error: error.message,
        stderr: stderr
      });
    }

    res.json({
      success: true,
      output: stdout
    });
  });
});

/* 🎬 MERGE ENDPOINT */
app.post("/merge", async (req, res) => {
  try {
    const { video1, video2, audio } = req.body;

    if (!video1 || !video2) {
      return res.status(400).json({ error: "video1 and video2 are required" });
    }

    const id = uuidv4();
    const video1Path = `./${id}_v1.mp4`;
    const video2Path = `./${id}_v2.mp4`;
    const audioPath = `./${id}_a.mp3`;
    const outputPath = `./${id}_final.mp4`;

    /* 📥 DOWNLOAD FUNCTION */
    const download = async (url, path) => {
      const writer = fs.createWriteStream(path);
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

    await download(video1, video1Path);
    await download(video2, video2Path);

    if (audio) {
      await download(audio, audioPath);
    }

    /* 🎞 FFMPEG COMMAND */
    const command = ffmpeg()
      .input(video1Path)
      .input(video2Path)
      .complexFilter([
        "[0:v][1:v]concat=n=2:v=1:a=0[outv]"
      ])
      .outputOptions([
        "-map [outv]"
      ]);

    if (audio) {
      command
        .input(audioPath)
        .outputOptions("-map 2:a");
    }

    command
      .save(outputPath)
      .on("end", () => {

        // Envoie le fichier
        res.download(outputPath, () => {
          // 🧹 Nettoyage des fichiers temporaires
          [video1Path, video2Path, audioPath, outputPath].forEach(file => {
            if (fs.existsSync(file)) {
              fs.unlinkSync(file);
            }
          });
        });

      })
      .on("error", (err) => {
        res.status(500).json({ error: err.message });
      });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* 🚀 START SERVER */
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
