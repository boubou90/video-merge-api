const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");

const app = express();
app.use(express.json());

/* ============================= */
/* 🔍 HEALTH CHECK               */
/* ============================= */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ============================= */
/* 🔍 FFMPEG TEST                */
/* ============================= */
app.get("/ffmpeg-test", (req, res) => {
  exec("ffmpeg -version", (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
    res.json({
      success: true,
      output: stdout
    });
  });
});

/* ============================= */
/* 🎬 MERGE ENDPOINT             */
/* ============================= */
app.post("/merge", async (req, res) => {
  try {
    const { video1, video2 } = req.body;

    if (!video1 || !video2) {
      return res.status(400).json({
        error: "video1 and video2 are required"
      });
    }

    const id = uuidv4();

    const video1Path = `/tmp/${id}_v1.mp4`;
    const video2Path = `/tmp/${id}_v2.mp4`;
    const concatFile = `/tmp/${id}_concat.txt`;
    const outputPath = `/tmp/${id}_final.mp4`;

    /* ---------------------------- */
    /* ⬇️ DOWNLOAD FUNCTION         */
    /* ---------------------------- */
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

    /* ---------------------------- */
    /* ⬇️ DOWNLOAD VIDEOS           */
    /* ---------------------------- */
    await download(video1, video1Path);
    await download(video2, video2Path);

    /* ---------------------------- */
    /* 📝 CREATE CONCAT FILE        */
    /* ---------------------------- */
    fs.writeFileSync(
      concatFile,
      `file '${video1Path}'\nfile '${video2Path}'`
    );

    /* ---------------------------- */
    /* 🎬 FFMPEG LIGHT CONCAT       */
    /* ---------------------------- */
    ffmpeg()
      .input(concatFile)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .save(outputPath)
      .on("end", () => {

        const stream = fs.createReadStream(outputPath);
        stream.pipe(res);

        stream.on("close", () => {
          // nettoyage
          [video1Path, video2Path, concatFile, outputPath].forEach(file => {
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

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================= */
/* 🚀 START SERVER               */
/* ============================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

