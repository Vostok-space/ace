"use strict";

var WorkerClient = require("../worker/worker_client").WorkerClient;
var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var JSONiqLexer = require("./xquery/jsoniq_lexer").JSONiqLexer;
var Range = require("../range").Range;
var XQueryBehaviour = require("./behaviour/xquery").XQueryBehaviour;
var CStyleFoldMode = require("./folding/cstyle").FoldMode;
var Anchor = require("../anchor").Anchor;

var Mode = function() {
    this.$tokenizer   = new JSONiqLexer();
    this.$behaviour   = new XQueryBehaviour();
    this.foldingRules = new CStyleFoldMode();
    this.$highlightRules = new TextHighlightRules();
};

oop.inherits(Mode, TextMode);

(function() {

    this.completer = {
        getCompletions: function(editor, session, pos, prefix, callback) {
            if (!session.$worker)
                return callback();
            session.$worker.emit("complete", { data: { pos: pos, prefix: prefix } });
            session.$worker.on("complete", function(e){
                callback(null, e.data);
            });
        }
    };

    this.getNextLineIndent = function(state, line, tab) {
        var indent = this.$getIndent(line);
        var match = line.match(/\s*(?:then|else|return|[{\(]|<\w+>)\s*$/);
        if (match)
            indent += tab;
        return indent;
    };
    
    this.checkOutdent = function(state, line, input) {
        if (! /^\s+$/.test(line))
            return false;

        return /^\s*[\}\)]/.test(input);
    };
    
    this.autoOutdent = function(state, doc, row) {
        var line = doc.getLine(row);
        var match = line.match(/^(\s*[\}\)])/);

        if (!match) return 0;

        var column = match[1].length;
        var openBracePos = doc.findMatchingBracket({row: row, column: column});

        if (!openBracePos || openBracePos.row == row) return 0;

        var indent = this.$getIndent(doc.getLine(openBracePos.row));
        doc.replace(new Range(row, 0, row, column-1), indent);
    };

    this.toggleCommentLines = function(state, doc, startRow, endRow) {
        var i, line;
        var outdent = true;
        var re = /^\s*\(:(.*):\)/;

        for (i=startRow; i<= endRow; i++) {
            if (!re.test(doc.getLine(i))) {
                outdent = false;
                break;
            }
        }

        var range = new Range(0, 0, 0, 0);
        for (i=startRow; i<= endRow; i++) {
            line = doc.getLine(i);
            range.start.row  = i;
            range.end.row    = i;
            range.end.column = line.length;

            doc.replace(range, outdent ? line.match(re)[1] : "(:" + line + ":)");
        }
    };
    this.createWorker = function(session) {
        
      var worker = new WorkerClient(["ace"], "ace/mode/xquery_worker", "XQueryWorker");
        var that = this;

        worker.attachToDocument(session.getDocument());
        
        worker.on("ok", function(e) {
          session.clearAnnotations();
        });
        
        worker.on("markers", function(e) {
          session.clearAnnotations();
          that.addMarkers(e.data, session);
        });
 
        return worker;
    };
 
    this.removeMarkers = function(session) {
        var markers = session.getMarkers(false);
        for (var id in markers) {
            // All language analysis' markers are prefixed with language_highlight
            if (markers[id].clazz.indexOf('language_highlight_') === 0) {
                session.removeMarker(id);
            }
        }
        for (var i = 0; i < session.markerAnchors.length; i++) {
            session.markerAnchors[i].detach();
        }
        session.markerAnchors = [];
    };

    this.addMarkers = function(annos, mySession) {
        var _self = this;
        
        if (!mySession.markerAnchors) mySession.markerAnchors = [];
        this.removeMarkers(mySession);
        mySession.languageAnnos = [];
        annos.forEach(function(anno) {
            // Certain annotations can temporarily be disabled
            //if (_self.disabledMarkerTypes[anno.type])
            //    return;
            // Multi-line markers are not supported, and typically are a result from a bad error recover, ignore
            //if(anno.pos.el && anno.pos.sl !== anno.pos.el)
            //    return;
            // Using anchors here, to automaticaly move markers as text around the marker is updated
            var anchor = new Anchor(mySession.getDocument(), anno.pos.sl, anno.pos.sc || 0);
            mySession.markerAnchors.push(anchor);
            var markerId;
            var colDiff = anno.pos.ec - anno.pos.sc;
            var rowDiff = anno.pos.el - anno.pos.sl;
            var gutterAnno = {
                guttertext: anno.message,
                type: anno.level || "warning",
                text: anno.message
                // row will be filled in updateFloat()
            };

            function updateFloat(single) {
                if (markerId)
                    mySession.removeMarker(markerId);
                gutterAnno.row = anchor.row;
                if (anno.pos.sc !== undefined && anno.pos.ec !== undefined) {
                    var range = new Range(anno.pos.sl, anno.pos.sc, anno.pos.el, anno.pos.ec);
                    //var range = Range.fromPoints(anchor.getPosition(), {
                    //    row: anchor.row + rowDiff,
                    //    column: anchor.column + colDiff
                    //});
                    markerId = mySession.addMarker(range, "language_highlight_" + (anno.type ? anno.type : "default"));
                }
                if (single) mySession.setAnnotations(mySession.languageAnnos);
            }
            updateFloat();
            anchor.on("change", function() {
                updateFloat(true);
            });
            if (anno.message) mySession.languageAnnos.push(gutterAnno);
        });
        mySession.setAnnotations(mySession.languageAnnos);
    }; 

    this.$id = "ace/mode/jsoniq";
    this.snippetFileId = "ace/snippets/jsoniq";
}).call(Mode.prototype);

exports.Mode = Mode;
