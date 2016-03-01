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

        function MeCab(args) {
            this.modelPtr = libMecab.mecab_model_new2('');
            if (this.modelPtr.isNull()) {
                var errorString = libMecab.mecab_strerror(null);
                throw new Error("Failed to create a new model - " + errorString);
            }

            this.taggerPtr = libMecab.mecab_model_new_tagger(this.modelPtr);
            if (this.taggerPtr.isNull()) {
                libMecab.mecab_model_destroy(this.modelPtr);
                var errorString = libMecab.mecab_strerror(this.taggerPtr);
                throw new Error("Failed to create a new tagger - " + errorString);
            }
        }

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
                var i, j, k, keyword, keywords, len, len1, morpheme, nouns, tempSN, uniqueKeywordMap, uniqueKeywords, v;
                if (err != null) {
                    return callback(err);
                }
                keywords = [];
                nouns = [];
                tempSN = '';
                for (i = 0, len = morphemes.length; i < len; i++) {
                    morpheme = morphemes[i];
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
                uniqueKeywordMap = {};
                for (j = 0, len1 = keywords.length; j < len1; j++) {
                    keyword = keywords[j];
                    uniqueKeywordMap[keyword] = keyword;
                }
                uniqueKeywords = [];
                for (k in uniqueKeywordMap) {
                    v = uniqueKeywordMap[k];
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
                var i, len, noun, nounMap;
                if (err != null) {
                    return callback(err);
                }
                nounMap = {};
                for (i = 0, len = nouns.length; i < len; i++) {
                    noun = nouns[i];
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
                var count, noun, nounCounts;
                if (err != null) {
                    return callback(err);
                }
                nounCounts = [];
                for (noun in nounMap) {
                    count = nounMap[noun];
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


    // default implementation
    module.exports = new MeCab();
    module.exports.MeCab = MeCab;

}).call(this);

