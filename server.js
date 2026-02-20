const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json({ limit: "10mb" }));

const TMP_DIR = "/tmp";

// --------------------------------------------------
// STREAM DOWNLOAD
// --------------------------------------------------
async function downloadFile(url, filepath) {
  const writer = fs.createWriteStream(filepath);

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

// --------------------------------------------------
// MERGE ROUTE
// --------------------------------------------------
app.post("/merge", async (req, res) => {
  try {
    const { video1, video2, audio, hook } = req.body;

    if (!video1 || !video2 || !audio || !hook) {
      return res.status(400).json({
        error: "video1, video2, audio and hook are required",
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
        {
          filter: "concat",
          options: { n: 2, v: 1, a: 0 },
          inputs: ["0:v", "1:v"],
          outputs: "vout",
        },
        {
          filter: "drawtext",
          options: {
            fontfile:
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            textfile: textFile,
            fontcolor: "white",
            fontsize: 48,
            borderw: 2,
            bordercolor: "black",
            x: "(w-text_w)/2",
            y: "100",
          },
          inputs: "vout",
          outputs: "vfinal",
        },
      ])
      .outputOptions([
        "-map [vfinal]",
        "-map 2:a",
        "-preset ultrafast",
        "-crf 32",
        "-threads 1",
        "-movflags +faststart",
      ])
      .videoCodec("libx264")
      .audioCodec("aac")
      .on("end", () => {
        console.log("FFmpeg finished");

        // On ne renvoie PAS le fichier ici
        res.json({
          success: true,
          id: id,
          downloadUrl: `/download/${id}`,
        });

        // Nettoyage automatique après 2 minutes
        setTimeout(() => {
          [v1, v2, a1, textFile, output].forEach((file) => {
            if (fs.existsSync(file)) fs.unlinkSync(file);
          });
        }, 120000);
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        res.status(500).json({ error: err.message });
      })
      .save(output);

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------
// DOWNLOAD ROUTE
// --------------------------------------------------
app.get("/download/:id", (req, res) => {
  const id = req.params.id;
  const filePath = path.join(TMP_DIR, `${id}_final.mp4`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.sendFile(filePath);
});

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
