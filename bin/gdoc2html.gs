var scriptProps = PropertiesService.getScriptProperties();
var userProps = PropertiesService.getUserProperties(); 
var ui = DocumentApp.getUi();

function onOpen() {
  DocumentApp.getUi()
      .createMenu('HTML Export')
      .addItem('Set GitHub Repository URL', 'setGitUrl')
      .addItem('Set GitHub API key', 'setApiKey')
      .addItem('Run Export', 'ConvertGoogleDocToCleanHtml')
      .addItem('Set Colab URL', 'setColabUrl')
      .addToUi();
}

function setApiKey(){
  var response = ui.prompt('Please copy and paste a personal access token from "https://github.com/settings/tokens"');
  if (response.getSelectedButton() == ui.Button.OK) {
    userProps.setProperty('apikey', response.getResponseText());
  } else {
    throw new Error("No key entered.");
  };
};

function setGitUrl(){
  var response = ui.prompt("\
Please paste the link to the GitHub repository. This should be either the canonical URL to the root page of the repository \
in the browser (https://github.com/USERNAME/REPO-NAME/) or a link to the browser address of the '.html' to \
output (https://github.com/USERNAME/REPO-NAME/blob/master/PATH/TO/OUTPUT.html). Other formats will not be accepted.");
  if (response.getSelectedButton() == ui.Button.OK) {
    var input = response.getResponseText();
    if (input.endsWith(".html")) {
      var htmlMatch = /https:\/\/github.com\/(.*)\/(.*)\/blob\/(.*)\/(.*).html/;
      if (!htmlMatch.test(input)) { throw new Error("Unrecognized repository URL."); };
      input = input.replace(htmlMatch, "https://api.github.com/repos/$1/$2/contents/$4.html");
    } else {
      var canonMatch = /https:\/\/github.com\/(.*)\/(.*)\//;
      if (!canonMatch.test(input)) { throw new Error("Unrecognized repository URL."); };
      input = input.replace(canonMatch, "https://api.github.com/repos/$1/$2/contents/article.html");
    }
    scriptProps.setProperty('giturl', input);
  } else {
    throw new Error("No API path given, aborting.");
  }
};

function setColabUrl(){
  var response = ui.prompt('Please enter the link to a hosted notebook on Google Colab (COLAB_URL ending in .ipynb). \
Descriptions of images including colab(XYZ) will insert a link directly to section XYZ of the colab (i.e. COLAB_URL#scrollTo=XYZ).');
  if (response.getSelectedButton() == ui.Button.OK) {
    userProps.setProperty('colaburl', response.getResponseText());
  } else {
    throw new Error("No URL entered..");
  };
};

function ConvertGoogleDocToCleanHtml() {
  const body = DocumentApp.getActiveDocument().getBody();
  var images = [];
  var listCounters = {};
  var output = [];
  let foundStart = false;
  for (let i=0; i<body.getNumChildren(); ++i) {
    const p = body.getChild(i);
    const text = p.getText().trim();
    foundStart |= (text == '<d-article>');
    if (!foundStart)
      continue;
    if ((text[0] == '<' && text[text.length-1] == '>') || text.slice(0, 2) == "%%") {
      output.push(text);
    } else {
      output.push(processItem(p, listCounters, images));
    }
  }
  var html = output.join('\n');
  var htmlb64 = Utilities.base64Encode(html, Utilities.Charset.UTF_8);
  
  //Check for saved GitHub url and token, else prompt for it.  
  if (scriptProps.getProperty("giturl") == null) { setGitUrl(); };
  if (userProps.getProperty("apikey") == null){ setApiKey(); };
  
  try {
    var response = UrlFetchApp.fetch(scriptProps.getProperty("giturl"), {
      'method' : 'GET',
      'headers': {
        'Authorization': 'token ' + userProps.getProperty("apikey") //'
      }
    });
  } catch (e) {
    throw new Error('Failed to connect to GitHub API with error: ' + e + '. Please check the GitHub repository URL or the access token.');
  }
  var articlefile = JSON.parse(response.getContentText());
  
  try {
    UrlFetchApp.fetch(scriptProps.getProperty("giturl"), {
      'method' : 'PUT',
      'payload' : JSON.stringify({
        "message": "auto update article.html",
        "sha": articlefile.sha,
        "committer": {
          "name": "selforg-bot",
          "email": "selforg@google.com"
        },
        "content": htmlb64
      }),
      'headers': {
        'Authorization': 'token ' + userProps.getProperty("apikey") //'
      }
    });
  } catch (e) {
    throw new Error('Failed to write to GitHub repository with error: ' + e + '. Please make sure you have write permission.');
  }
  DocumentApp.getUi().alert('Successfully expored article HTML to GitHub');
}


function dumpAttributes(atts) {
  // Log the paragraph attributes.
  for (var att in atts) {
    Logger.log(att + ":" + atts[att]);
  }
}

function processItem(item, listCounters, images) {
  var output = [];
  var prefix = "", suffix = "";
  if (item.getType() == DocumentApp.ElementType.PARAGRAPH) {
    switch (item.getHeading()) {
      case DocumentApp.ParagraphHeading.HEADING6: 
        prefix = "<h6>", suffix = "</h6>"; break;
      case DocumentApp.ParagraphHeading.HEADING5: 
        prefix = "<h5>", suffix = "</h5>"; break;
      case DocumentApp.ParagraphHeading.HEADING4:
        prefix = "<h4>", suffix = "</h4>"; break;
      case DocumentApp.ParagraphHeading.HEADING3:
        prefix = "<h3>", suffix = "</h3>"; break;
      case DocumentApp.ParagraphHeading.HEADING2:
        var title = ""
        title = item.getText();
        title = title.replace(/[^A-Za-z0-9 ']/g, "").toLowerCase().split(" ").slice(0, 2).join("-");
        prefix = "<h2 id='" + title + "'>", suffix = "</h2>"; break;
      case DocumentApp.ParagraphHeading.HEADING1:
        prefix = "<h1>", suffix = "</h1>"; break;
      default: 
        prefix = "<p>", suffix = "</p>";
    }

    if (item.getNumChildren() == 0)
      return "";

    if (item.getNumChildren() == 1 ) {
      const childType = item.getChild(0).getType();
      if (childType == DocumentApp.ElementType.INLINE_IMAGE ||
          childType == DocumentApp.ElementType.INLINE_DRAWING) {
        // for custom figure properties we can add those ourselves.
        const alt = item.getChild(0).getAltDescription();
        if (alt && !alt.startsWith("<figure")) {
          prefix = "<figure>";
          suffix = "</figure>";
        }
      }
    }
  }
  else if (item.getType() == DocumentApp.ElementType.INLINE_IMAGE)
  {
    processImage(item, images, output);
  }
  else if (item.getType() == DocumentApp.ElementType.INLINE_DRAWING)
  {
    processImage(item, images, output);
  } else if (item.getType() == DocumentApp.ElementType.FOOTNOTE) {
    const text = processString(item.getFootnoteContents().getText());
    output.push(`<d-footnote>${text}</d-footnote>`)
  }  else if (item.getType()===DocumentApp.ElementType.LIST_ITEM) {
    prefix = "<ul><li>";
    suffix = "</li></ul>";
  }

  output.push(prefix);

  if (item.getType() == DocumentApp.ElementType.TEXT) {
    processText(item, output);
  }
  else {
    if (item.getNumChildren) {
      var numChildren = item.getNumChildren();

      // Walk through all the child elements of the doc.
      for (var i = 0; i < numChildren; i++) {
        var child = item.getChild(i);
        output.push(processItem(child, listCounters, images));
      }
    }

  }

  output.push(suffix);
  return output.join('');
}

function processString(s) {
  s = s.replace(/\[\[([^\[\]]+)\]\]/g, '<d-cite key="$1"></d-cite>');
  return s;
}

function processText(item, output) {
  var text = item.getText();
  var indices = item.getTextAttributeIndices();

  for (var i=0; i < indices.length; i ++) {
    var partAtts = item.getAttributes(indices[i]);
    var startPos = indices[i];
    var endPos = i+1 < indices.length ? indices[i+1]: text.length;
    var partText = text.substring(startPos, endPos);

    if (partAtts.ITALIC) {
      output.push('<i>');
    }
    if (partAtts.BOLD) {
      output.push('<strong>');
    }
    if (partAtts.UNDERLINE) {
      output.push('<u>');
    }

    // process citations
    output.push(processString(partText));

    if (partAtts.ITALIC) {
      output.push('</i>');
    }
    if (partAtts.BOLD) {
      output.push('</strong>');
    }
    if (partAtts.UNDERLINE) {
      output.push('</u>');
    }
  }
}

function processImage(item, images, output) {
  var description = item.getAltDescription();
  if (description) {
    if (scriptProps.getProperty("colaburl")){ 
      var colablink = "<a href=\"" + scriptProps.getProperty("colaburl") + "#scrollTo=$1\" class=\"colab-root\">Reproduce in a <span class=\"colab-span\">Notebook</span></a>";
      description = description.replace(/colab\(([a-zA-Z0-9_-]+)\)/gm, colablink);
    }
    output.push(description);
  }
}