const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json({ limit: "10mb" }));

const TMP_DIR = "/tmp";

// ----------------------
// STREAM DOWNLOAD
// ----------------------
async function downloadFile(url, filepath) {
  const writer = fs.createWriteStream(filepath);
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream"
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

// ----------------------
// MERGE ROUTE
// ----------------------
app.post("/merge", async (req, res) => {
  try {
    const { video1, video2, audio, hook } = req.body;

    if (!video1 || !video2 || !audio || !hook) {
      return res.status(400).json({
        error: "video1, video2, audio and hook are required"
      });
    }

    const id = uuidv4();

    const v1 = path.join(TMP_DIR, `${id}_v1.mp4`);
    const v2 = path.join(TMP_DIR, `${id}_v2.mp4`);
    const a1 = path.join(TMP_DIR, `${id}_a.mp3`);
    const textFile = path.join(TMP_DIR, `${id}_text.txt`);
    const output = path.join(TMP_DIR, `${id}_final.mp4`);

    console.log("Downloading assets...");

    await downloadFile(video1, v1);
    await downloadFile(video2, v2);
    await downloadFile(audio, a1);

    fs.writeFileSync(textFile, hook);

    console.log("Starting ffmpeg...");

    ffmpeg()
      .input(v1)
      .input(v2)
      .input(a1)
      .complexFilter([
        // 1️⃣ Concat videos
        {
          filter: "concat",
          options: { n: 2, v: 1, a: 0 },
          inputs: ["0:v", "1:v"],
          outputs: "vout"
        },

        // 2️⃣ Pad audio if too short
        {
          filter: "apad",
          inputs: "2:a",
          outputs: "apadded"
        },

        // 3️⃣ Trim audio to video length
        {
          filter: "atrim",
          options: { duration: 9999 },
          inputs: "apadded",
          outputs: "afinal"
        },

        // 4️⃣ Add text overlay
        {
          filter: "drawtext",
          options: {
            fontfile:
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            textfile: textFile,
            fontcolor: "white",
            fontsize: 60,
            borderw: 3,
            bordercolor: "black",
            x: "(w-text_w)/2",
            y: "120"
          },
          inputs: "vout",
          outputs: "vfinal"
        }
      ])
      .outputOptions([
        "-map [vfinal]",
        "-map [afinal]",
        "-shortest", // audio = durée vidéo
        "-preset veryfast",
        "-crf 23",
        "-movflags +faststart"
      ])
      .videoCodec("libx264")
      .audioCodec("aac")
      .on("end", () => {
        console.log("FFmpeg finished");

        res.json({
          success: true,
          id,
          downloadUrl: `/download/${id}`
        });
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        res.status(500).json({ error: err.message });
      })
      .save(output);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------
// DOWNLOAD ROUTE
// ----------------------
app.get("/download/:id", (req, res) => {
  const filePath = path.join(TMP_DIR, `${req.params.id}_final.mp4`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath, () => {
    fs.unlinkSync(filePath);
  });
});

// ----------------------
// HEALTH CHECK
// ----------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ----------------------
// START SERVER
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
