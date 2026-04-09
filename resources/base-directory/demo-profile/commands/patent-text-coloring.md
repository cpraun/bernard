---
command: /patent-text-coloring
description: Converts a patent application or invention disclosure provided in context into a colour-coded HTML document. Highlights sentences according to three categories — conventional technology / state of the art (yellow), disadvantages or problems of the state of the art (red), and advantages of the disclosed technology (green). This command implements the ideas of IPGOGGLES (see https://ipgoggles.com)
argument-hint: none
context-hint: patent document in TXT format
agent:
---

# Input Validation

Before starting, check the context for an uploaded document:

- If **no file** is found in context: stop and output the following error message:
  > ⚠️ **No document found.** Please upload a patent application or invention disclosure and run this command again.

- If **more than one file** is found in context: stop and output the following error message:
  > ⚠️ **Multiple documents found.** Please ensure only one document is provided in context and run this command again.

- If exactly **one file** is found: If the fil is TXT file proceed with the steps below. Otherwise: stop and output the following error message:
  > ⚠️ **This command works best with files types TXT** If you have only a PDF file at hand, runs the OCR before and choose the resulting TXT file as context.

---

# Task

You will process the document and produce a complete, colour-coded HTML file.

## Step 1 — Read

Read the *complete* document, sentence by sentence. Sentences are separated by a dot ".". While reading, determine in which of the following four categories each individual sentence falls most likely: 
(A) the sentence clearly describes conventional technology and state of the art  
(B) the sentence clearly describes disadvantages or problems of the state of the art that are to be solved  
(C) the sentence clearly describes advantages of the technology disclosed in the document.  
(D) none of the (A), (B), (C)


## Step 2 — Convert to HTML and Apply Colour Coding 

Convert the full document text into a well-formed, pretty-printed HTML document using the CSS stylesheet specified below. The HTML output must:

- Be a complete, standalone HTML file (including `<!DOCTYPE html>`, `<html>`, `<head>`, and `<body>` tags)
- Contain the **entire** text of the source document 
- Preserve all structural elements
- Begin with the colour-coding legend defined in the stylesheet

Thereby, apply a `<span>` with the appropriate CSS class (state-of-the-art, problem, advantage) according to the following rules the following coloring to each sentence: 

   - 🟡 **Yellow** / state-of-the-art — if the sentence falls in category (A)
   - 🔴 **Red** / problem — if the sentence falls into category (B)
   - 🟢 **Green** / advantage — if the sentence falls into category (C)
   - no coloring for category (D)

Sentences that do not fall into any of these categories (e.g. transitional phrases, claim language, reference sign lists) are left unformatted.

Apply the the above color coding to each an every sentence in the HTML document.

## Step 4 — Output

Output only the HTML text document!

---

# HTML Template and CSS

Use the following stylesheet. Do not modify the CSS.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>[Document Title]</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 900px;
            margin: 40px auto;
            padding: 20px;
            background-color: #f9f9f9;
        }
        .document-container {
            background-color: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }
        h1, h2, h3 {
            color: #2c3e50;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
        }
        .paragraph-num {
            font-weight: bold;
            color: #7f8c8d;
            margin-right: 10px;
            display: inline-block;
            width: 50px;
        }
        p {
            margin-bottom: 20px;
            text-align: justify;
        }

        /* Colour Coding */
        .state-of-the-art { background-color: #ffffcc; } /* Yellow — prior art */
        .problem          { background-color: #ffcccc; } /* Red    — problems   */
        .advantage        { background-color: #ccffcc; } /* Green  — advantages */

        /* Legend */
        .legend {
            margin-bottom: 30px;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
            background-color: #fff;
        }
        .legend-title {
            font-weight: bold;
            margin-bottom: 8px;
        }
        .legend-item {
            display: inline-block;
            margin-right: 20px;
            font-size: 0.9em;
        }
        .box {
            display: inline-block;
            width: 15px;
            height: 15px;
            margin-right: 5px;
            vertical-align: middle;
            border: 1px solid #999;
        }
        .box-yellow { background-color: #ffffcc; }
        .box-red    { background-color: #ffcccc; }
        .box-green  { background-color: #ccffcc; }
    </style>
</head>
<body>
<div class="document-container">

    <!-- Legend -->
    <div class="legend">
        <div class="legend-title">Colour Code</div>
        <span class="legend-item"><span class="box box-yellow"></span>State of the art / prior art</span>
        <span class="legend-item"><span class="box box-red"></span>Problems / disadvantages of prior art</span>
        <span class="legend-item"><span class="box box-green"></span>Advantages of disclosed technology</span>
    </div>

    <!-- Document content goes here -->

</div>
</body>
</html>
```
