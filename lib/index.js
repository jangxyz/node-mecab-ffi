(function() {
    var async = require('async');

    var ref = require('ref');
    var ffi = require('ffi');

    var ModelType      = ref.types["void"];
    var ModelTypePtr   = ref.refType(ModelType);
    var TaggerType     = ref.types["void"];
    var TaggerTypePtr  = ref.refType(TaggerType);
    var LatticeType    = ref.types["void"];
    var LatticeTypePtr = ref.refType(LatticeType);

    var libMecab = ffi.Library('libmecab', {
        'mecab_model_new2': [ModelTypePtr, ['string']],
        'mecab_model_destroy': ['void', [ModelTypePtr]],
        'mecab_model_new_tagger': [TaggerTypePtr, [ModelTypePtr]],
        'mecab_model_new_lattice': [LatticeTypePtr, [ModelTypePtr]],
        'mecab_lattice_set_sentence': ['void', [LatticeTypePtr, 'string']],
        'mecab_parse_lattice': ['void', [TaggerTypePtr, LatticeTypePtr]],
        'mecab_lattice_tostr': ['string', [LatticeTypePtr]],
        'mecab_lattice_clear': ['void', [LatticeTypePtr]],
        'mecab_lattice_destroy': ['void', [LatticeTypePtr]],
        'mecab_strerror': ['string', [TaggerTypePtr]]
    });


    function parseMeCabOutputString(outputString) {
        var result = [];
        outputString.split('\n').forEach(function(line) {
            return result.push(line.replace('\t', ',').split(','));
        });
        return result.slice(0, -2);
    }

    //

    var MeCab = (function() {

        function MeCab(arg) {
            arg = MeCab.optParse(arg);

            // model
            this.modelPtr = libMecab.mecab_model_new2(arg);
            if (this.modelPtr.isNull()) {
                var errorString = libMecab.mecab_strerror(null);
                throw new Error("Failed to create a new model - " + errorString);
            }

            // tagger
            this.taggerPtr = libMecab.mecab_model_new_tagger(this.modelPtr);
            if (this.taggerPtr.isNull()) {
                libMecab.mecab_model_destroy(this.modelPtr);
                var errorString = libMecab.mecab_strerror(this.taggerPtr);
                throw new Error("Failed to create a new tagger - " + errorString);
            }
        }

        /*
         *
         *   -r, --rcfile=FILE              use FILE as resource file
         *   -d, --dicdir=DIR               set DIR  as a system dicdir
         *   -u, --userdic=FILE             use FILE as a user dictionary
         *   -l, --lattice-level=INT        lattice information level (DEPRECATED)
         *   -D, --dictionary-info          show dictionary information and exit
         *   -O, --output-format-type=TYPE  set output format type (wakati,none,...)
         *   -a, --all-morphs               output all morphs(default false)
         *   -N, --nbest=INT                output N best results (default 1)
         *   -p, --partial                  partial parsing mode (default false)
         *   -m, --marginal                 output marginal probability (default false)
         *   -M, --max-grouping-size=INT    maximum grouping size for unknown words (default 24)
         *   -F, --node-format=STR          use STR as the user-defined node format
         *   -U, --unk-format=STR           use STR as the user-defined unknown node format
         *   -B, --bos-format=STR           use STR as the user-defined beginning-of-sentence format
         *   -E, --eos-format=STR           use STR as the user-defined end-of-sentence format
         *   -S, --eon-format=STR           use STR as the user-defined end-of-NBest format
         *   -x, --unk-feature=STR          use STR as the feature for unknown word
         *   -b, --input-buffer-size=INT    set input buffer size (default 8192)
         *   -P, --dump-config              dump MeCab parameters
         *   -C, --allocate-sentence        allocate new memory for input sentence
         *   -t, --theta=FLOAT              set temparature parameter theta (default 0.75)
         *   -c, --cost-factor=INT          set cost factor (default 700)
         *   -o, --output=FILE              set the output file name
         *   -v, --version                  show the version and exit.
         *   -h, --help                     show this help and exit.
         *
         */
        MeCab.optParse = function(arg) {
            arg = arg || '';
            return arg;
        };

        /*
         * parse
         */

        MeCab.prototype.parse = function(inputString, callback) {
            var self = this;
            return async.waterfall([
                function(callback) {
                    return libMecab.mecab_model_new_lattice.async(self.modelPtr, function(err, latticePtr) {
                        if (latticePtr.isNull()) {
                            var errorString = libMecab.mecab_strerror(self.taggerPtr);
                            return callback(new Error("Failed to create a new lattice - " + errorString));
                        }
                        return callback(err, latticePtr);
                    });
                }, function(latticePtr, callback) {
                    return libMecab.mecab_lattice_set_sentence.async(latticePtr, inputString, function(err) {
                        return callback(err, latticePtr);
                    });
                }, function(latticePtr, callback) {
                    return libMecab.mecab_parse_lattice.async(self.taggerPtr, latticePtr, function(err) {
                        return callback(err, latticePtr);
                    });
                }, function(latticePtr, callback) {
                    return libMecab.mecab_lattice_tostr.async(latticePtr, function(err, outputString) {
                        return callback(err, latticePtr, outputString);
                    });
                }, function(latticePtr, outputString, callback) {
                    return libMecab.mecab_lattice_destroy.async(latticePtr, function(err) {
                        return callback(err, outputString);
                    });
                }
            ], function(err, outputString) {
                if (err != null) {
                    return callback(err);
                }
                return callback(null, parseMeCabOutputString(outputString));
            });
        };

        MeCab.prototype.parseSync = function(inputString) {
            var latticePtr, outputString;
            latticePtr = libMecab.mecab_model_new_lattice(this.modelPtr);
            if (latticePtr.isNull()) {
                var errorString = libMecab.mecab_strerror(this.taggerPtr);
                return callback(new Error("Failed to create a new lattice - " + errorString));
            }
            libMecab.mecab_lattice_set_sentence(latticePtr, inputString);
            libMecab.mecab_parse_lattice(this.taggerPtr, latticePtr);
            outputString = libMecab.mecab_lattice_tostr(latticePtr);
            libMecab.mecab_lattice_destroy(latticePtr);
            return parseMeCabOutputString(outputString);
        };


        /*
         * extract
         */

        MeCab.prototype.extractNouns = function(inputString, callback) {
            return this.parse(inputString, function(err, morphemes) {
                var i, index, len, morpheme, nouns, prevMorpheme, prevPrevMorpheme;
                if (err != null) {
                    return callback(err);
                }
                nouns = [];
                for (index = i = 0, len = morphemes.length; i < len; index = ++i) {
                    morpheme = morphemes[index];
                    if (morpheme[1] === 'NN') {
                        if (index > 0) {
                            prevMorpheme = morphemes[index - 1];
                            if (prevMorpheme[1] === 'SN' || prevMorpheme[1] === 'NN' || prevMorpheme[1] === 'VA+ETM') {
                                nouns.push(prevMorpheme[0] + " " + morpheme[0]);
                            }
                            if (index > 1) {
                                prevPrevMorpheme = morphemes[index - 2];
                                if (prevPrevMorpheme[1] === 'VA' && prevMorpheme[1] === 'ETM') {
                                    nouns.push("" + prevPrevMorpheme[0] + prevMorpheme[0] + " " + morpheme[0]);
                                }
                            }
                        }
                        if (morpheme[1] === 'NN') {
                            nouns.push(morpheme[0]);
                        }
                    }
                }
                return callback(null, nouns);
            });
        };

        MeCab.prototype.extractKeywords = function(inputString, options, callback) {
            if (typeof options === 'function') {
                callback = options;
                options = {};
            }
            if (options == null) {
                options = {};
            }
            if (options.n == null) {
                options.n = 3;
            }

            return this.parse(inputString, function(err, morphemes) {
                if (err != null) {
                    return callback(err);
                }
                var keywords = [];
                var nouns = [];
                var tempSN = '';
                for (var i = 0, len = morphemes.length; i < len; i++) {
                    var morpheme = morphemes[i];
                    if (morpheme[1] === 'SN') {
                        tempSN = morpheme[0];
                    } else if (morpheme[1] === 'NN' && morpheme[0].length > 1 && morpheme[4] === '*') {
                        nouns.push("" + tempSN + morpheme[0]);
                        tempSN = '';
                    } else {
                        if (nouns.length > 1) {
                            keywords.push(nouns.join(' '));
                        }
                        nouns = [];
                        tempSN = '';
                    }
                }
                var uniqueKeywordMap = {};
                for (var j = 0, len1 = keywords.length; j < len1; j++) {
                    var keyword = keywords[j];
                    uniqueKeywordMap[keyword] = keyword;
                }
                var uniqueKeywords = [];
                for (var k in uniqueKeywordMap) {
                    var v = uniqueKeywordMap[k];
                    uniqueKeywords.push(v);
                }
                uniqueKeywords = uniqueKeywords.slice(0, options.n);
                uniqueKeywords.sort(function(a, b) {
                    return b.length - a.length;
                });
                return callback(null, uniqueKeywords);
            });
        };

        MeCab.prototype.extractNounMap = function(inputString, callback) {
            return this.extractNouns(inputString, function(err, nouns) {
                if (err != null) {
                    return callback(err);
                }
                var nounMap = {};
                for (var i = 0, len = nouns.length; i < len; i++) {
                    var noun = nouns[i];
                    if (nounMap[noun] == null) {
                        nounMap[noun] = 0;
                    }
                    nounMap[noun]++;
                }
                return callback(null, nounMap);
            });
        };

        MeCab.prototype.extractSortedNounCounts = function(inputString, callback) {
            return this.extractNounMap(inputString, function(err, nounMap) {
                if (err != null) {
                    return callback(err);
                }
                var nounCounts = [];
                for (var noun in nounMap) {
                    var count = nounMap[noun];
                    nounCounts.push({
                        noun: noun,
                        count: count
                    });
                }
                nounCounts.sort(function(a, b) {
                    return b.count - a.count;
                });
                return callback(null, nounCounts);
            });
        };


        /*
         * Dice Coefficient
         */

        MeCab.prototype.getDiceCoefficientByNounMap = function(nounMapA, nounMapB, callback) {
            var countA, countB, noun, score;
            score = 0;
            for (noun in nounMapA) {
                countA = nounMapA[noun];
                countB = 0;
                if (nounMapB[noun] != null) {
                    countB = nounMapB[noun];
                }
                score += countA * countB;
            }
            return callback(null, score);
        };

        MeCab.prototype.getDiceCoefficientByString = function(inputStringA, inputStringB, callback) {
            var self = this;
            return async.parallel({
                nounMapA: function(callback) {
                    return self.extractNounMap(inputStringA, callback);
                },
                nounMapB: function(callback) {
                    return self.extractNounMap(inputStringB, callback);
                }
            }, function(err, result) {
                return self.getDiceCoefficientByNounMap(result.nounMapA, result.nounMapB, callback);
            });
        };

        //
        return MeCab;
    })();


    // use default implementation as module
    module.exports = new MeCab();
    module.exports.MeCab = MeCab;

}).call(this);

