/**
 * HTML **character references** — `&name;` and `&#NN;` — read as the
 * browser's HTML parser reads them, which is how Mermaid's entity codes
 * reach its picture: it rewrites `#name;` as `&name;` and `#NN;` as
 * `&#NN;`, and the browser resolves what it was handed (ADR-0015;
 * `readLabel` says which dialect reads what).
 *
 * Every name the HTML standard defines resolves (`#copy;` is `©`, measured
 * in Mermaid 11.17.2's HTML labels), and an unknown one is left as the
 * reference the browser was handed (`#foo;` draws `&foo;`). A **legacy**
 * name — one of the 106 the standard also accepts without its `;` —
 * resolves as the longest prefix of a longer word (`#notit;` draws `¬it;`,
 * `#ampx;` draws `&x;`). A number that names no character draws `\uFFFD`
 * (`#0;`), and one from 128 to 159 the windows-1252 character at that byte
 * (`#128;` is `€`).
 */

/**
 * The HTML standard's named character references, `name:codepoints`: the
 * code points in hex, `+` between two; a leading `*` marks a legacy name,
 * one also read without its `;`.
 *
 * Generated from the WHATWG table (2,231 entries: 2,125 names, 106 of them
 * also legacy) as packaged by `entities` 6.0.1, the decoder jsdom's parser
 * uses — the parser `mermaid-probe.mjs` measures through. The standard
 * declares the table will never change.
 */
const NAMED = `
  *AElig:C6 *AMP:26 *Aacute:C1 Abreve:102 *Acirc:C2 Acy:410 Afr:1D504 *Agrave:C0 Alpha:391
  Amacr:100 And:2A53 Aogon:104 Aopf:1D538 ApplyFunction:2061 *Aring:C5 Ascr:1D49C Assign:2254
  *Atilde:C3 *Auml:C4 Backslash:2216 Barv:2AE7 Barwed:2306 Bcy:411 Because:2235 Bernoullis:212C
  Beta:392 Bfr:1D505 Bopf:1D539 Breve:2D8 Bscr:212C Bumpeq:224E CHcy:427 *COPY:A9 Cacute:106
  CapitalDifferentialD:2145 Cap:22D2 Cayleys:212D Ccaron:10C *Ccedil:C7 Ccirc:108 Cconint:2230
  Cdot:10A Cedilla:B8 CenterDot:B7 Cfr:212D Chi:3A7 CircleDot:2299 CircleMinus:2296
  CirclePlus:2295 CircleTimes:2297 ClockwiseContourIntegral:2232 CloseCurlyDoubleQuote:201D
  CloseCurlyQuote:2019 Colone:2A74 Colon:2237 Congruent:2261 Conint:222F ContourIntegral:222E
  Copf:2102 Coproduct:2210 CounterClockwiseContourIntegral:2233 Cross:2A2F Cscr:1D49E CupCap:224D
  Cup:22D3 DDotrahd:2911 DD:2145 DJcy:402 DScy:405 DZcy:40F Dagger:2021 Darr:21A1 Dashv:2AE4
  Dcaron:10E Dcy:414 Delta:394 Del:2207 Dfr:1D507 DiacriticalAcute:B4 DiacriticalDot:2D9
  DiacriticalDoubleAcute:2DD DiacriticalGrave:60 DiacriticalTilde:2DC Diamond:22C4
  DifferentialD:2146 Dopf:1D53B DotDot:20DC DotEqual:2250 Dot:A8 DoubleContourIntegral:222F
  DoubleDot:A8 DoubleDownArrow:21D3 DoubleLeftArrow:21D0 DoubleLeftRightArrow:21D4
  DoubleLeftTee:2AE4 DoubleLongLeftArrow:27F8 DoubleLongLeftRightArrow:27FA
  DoubleLongRightArrow:27F9 DoubleRightArrow:21D2 DoubleRightTee:22A8 DoubleUpArrow:21D1
  DoubleUpDownArrow:21D5 DoubleVerticalBar:2225 DownArrowBar:2913 DownArrowUpArrow:21F5
  DownArrow:2193 DownBreve:311 DownLeftRightVector:2950 DownLeftTeeVector:295E
  DownLeftVectorBar:2956 DownLeftVector:21BD DownRightTeeVector:295F DownRightVectorBar:2957
  DownRightVector:21C1 DownTeeArrow:21A7 DownTee:22A4 Downarrow:21D3 Dscr:1D49F Dstrok:110 ENG:14A
  *ETH:D0 *Eacute:C9 Ecaron:11A *Ecirc:CA Ecy:42D Edot:116 Efr:1D508 *Egrave:C8 Element:2208
  Emacr:112 EmptySmallSquare:25FB EmptyVerySmallSquare:25AB Eogon:118 Eopf:1D53C Epsilon:395
  EqualTilde:2242 Equal:2A75 Equilibrium:21CC Escr:2130 Esim:2A73 Eta:397 *Euml:CB Exists:2203
  ExponentialE:2147 Fcy:424 Ffr:1D509 FilledSmallSquare:25FC FilledVerySmallSquare:25AA Fopf:1D53D
  ForAll:2200 Fouriertrf:2131 Fscr:2131 GJcy:403 *GT:3E Gammad:3DC Gamma:393 Gbreve:11E Gcedil:122
  Gcirc:11C Gcy:413 Gdot:120 Gfr:1D50A Gg:22D9 Gopf:1D53E GreaterEqualLess:22DB GreaterEqual:2265
  GreaterFullEqual:2267 GreaterGreater:2AA2 GreaterLess:2277 GreaterSlantEqual:2A7E
  GreaterTilde:2273 Gscr:1D4A2 Gt:226B HARDcy:42A Hacek:2C7 Hat:5E Hcirc:124 Hfr:210C
  HilbertSpace:210B Hopf:210D HorizontalLine:2500 Hscr:210B Hstrok:126 HumpDownHump:224E
  HumpEqual:224F IEcy:415 IJlig:132 IOcy:401 *Iacute:CD *Icirc:CE Icy:418 Idot:130 Ifr:2111
  *Igrave:CC Imacr:12A ImaginaryI:2148 Implies:21D2 Im:2111 Integral:222B Intersection:22C2
  Int:222C InvisibleComma:2063 InvisibleTimes:2062 Iogon:12E Iopf:1D540 Iota:399 Iscr:2110
  Itilde:128 Iukcy:406 *Iuml:CF Jcirc:134 Jcy:419 Jfr:1D50D Jopf:1D541 Jscr:1D4A5 Jsercy:408
  Jukcy:404 KHcy:425 KJcy:40C Kappa:39A Kcedil:136 Kcy:41A Kfr:1D50E Kopf:1D542 Kscr:1D4A6
  LJcy:409 *LT:3C Lacute:139 Lambda:39B Lang:27EA Laplacetrf:2112 Larr:219E Lcaron:13D Lcedil:13B
  Lcy:41B LeftAngleBracket:27E8 LeftArrowBar:21E4 LeftArrowRightArrow:21C6 LeftArrow:2190
  LeftCeiling:2308 LeftDoubleBracket:27E6 LeftDownTeeVector:2961 LeftDownVectorBar:2959
  LeftDownVector:21C3 LeftFloor:230A LeftRightArrow:2194 LeftRightVector:294E LeftTeeArrow:21A4
  LeftTeeVector:295A LeftTee:22A3 LeftTriangleBar:29CF LeftTriangleEqual:22B4 LeftTriangle:22B2
  LeftUpDownVector:2951 LeftUpTeeVector:2960 LeftUpVectorBar:2958 LeftUpVector:21BF
  LeftVectorBar:2952 LeftVector:21BC Leftarrow:21D0 Leftrightarrow:21D4 LessEqualGreater:22DA
  LessFullEqual:2266 LessGreater:2276 LessLess:2AA1 LessSlantEqual:2A7D LessTilde:2272 Lfr:1D50F
  Lleftarrow:21DA Ll:22D8 Lmidot:13F LongLeftArrow:27F5 LongLeftRightArrow:27F7
  LongRightArrow:27F6 Longleftarrow:27F8 Longleftrightarrow:27FA Longrightarrow:27F9 Lopf:1D543
  LowerLeftArrow:2199 LowerRightArrow:2198 Lscr:2112 Lsh:21B0 Lstrok:141 Lt:226A Map:2905 Mcy:41C
  MediumSpace:205F Mellintrf:2133 Mfr:1D510 MinusPlus:2213 Mopf:1D544 Mscr:2133 Mu:39C NJcy:40A
  Nacute:143 Ncaron:147 Ncedil:145 Ncy:41D NegativeMediumSpace:200B NegativeThickSpace:200B
  NegativeThinSpace:200B NegativeVeryThinSpace:200B NestedGreaterGreater:226B NestedLessLess:226A
  NewLine:A Nfr:1D511 NoBreak:2060 NonBreakingSpace:A0 Nopf:2115 NotCongruent:2262 NotCupCap:226D
  NotDoubleVerticalBar:2226 NotElement:2209 NotEqualTilde:2242+338 NotEqual:2260 NotExists:2204
  NotGreaterEqual:2271 NotGreaterFullEqual:2267+338 NotGreaterGreater:226B+338 NotGreaterLess:2279
  NotGreaterSlantEqual:2A7E+338 NotGreaterTilde:2275 NotGreater:226F NotHumpDownHump:224E+338
  NotHumpEqual:224F+338 NotLeftTriangleBar:29CF+338 NotLeftTriangleEqual:22EC NotLeftTriangle:22EA
  NotLessEqual:2270 NotLessGreater:2278 NotLessLess:226A+338 NotLessSlantEqual:2A7D+338
  NotLessTilde:2274 NotLess:226E NotNestedGreaterGreater:2AA2+338 NotNestedLessLess:2AA1+338
  NotPrecedesEqual:2AAF+338 NotPrecedesSlantEqual:22E0 NotPrecedes:2280 NotReverseElement:220C
  NotRightTriangleBar:29D0+338 NotRightTriangleEqual:22ED NotRightTriangle:22EB
  NotSquareSubsetEqual:22E2 NotSquareSubset:228F+338 NotSquareSupersetEqual:22E3
  NotSquareSuperset:2290+338 NotSubsetEqual:2288 NotSubset:2282+20D2 NotSucceedsEqual:2AB0+338
  NotSucceedsSlantEqual:22E1 NotSucceedsTilde:227F+338 NotSucceeds:2281 NotSupersetEqual:2289
  NotSuperset:2283+20D2 NotTildeEqual:2244 NotTildeFullEqual:2247 NotTildeTilde:2249 NotTilde:2241
  NotVerticalBar:2224 Not:2AEC Nscr:1D4A9 *Ntilde:D1 Nu:39D OElig:152 *Oacute:D3 *Ocirc:D4 Ocy:41E
  Odblac:150 Ofr:1D512 *Ograve:D2 Omacr:14C Omega:3A9 Omicron:39F Oopf:1D546
  OpenCurlyDoubleQuote:201C OpenCurlyQuote:2018 Or:2A54 Oscr:1D4AA *Oslash:D8 *Otilde:D5
  Otimes:2A37 *Ouml:D6 OverBar:203E OverBrace:23DE OverBracket:23B4 OverParenthesis:23DC
  PartialD:2202 Pcy:41F Pfr:1D513 Phi:3A6 Pi:3A0 PlusMinus:B1 Poincareplane:210C Popf:2119
  PrecedesEqual:2AAF PrecedesSlantEqual:227C PrecedesTilde:227E Precedes:227A Prime:2033
  Product:220F Proportional:221D Proportion:2237 Pr:2ABB Pscr:1D4AB Psi:3A8 *QUOT:22 Qfr:1D514
  Qopf:211A Qscr:1D4AC RBarr:2910 *REG:AE Racute:154 Rang:27EB Rarrtl:2916 Rarr:21A0 Rcaron:158
  Rcedil:156 Rcy:420 ReverseElement:220B ReverseEquilibrium:21CB ReverseUpEquilibrium:296F Re:211C
  Rfr:211C Rho:3A1 RightAngleBracket:27E9 RightArrowBar:21E5 RightArrowLeftArrow:21C4
  RightArrow:2192 RightCeiling:2309 RightDoubleBracket:27E7 RightDownTeeVector:295D
  RightDownVectorBar:2955 RightDownVector:21C2 RightFloor:230B RightTeeArrow:21A6
  RightTeeVector:295B RightTee:22A2 RightTriangleBar:29D0 RightTriangleEqual:22B5
  RightTriangle:22B3 RightUpDownVector:294F RightUpTeeVector:295C RightUpVectorBar:2954
  RightUpVector:21BE RightVectorBar:2953 RightVector:21C0 Rightarrow:21D2 Ropf:211D
  RoundImplies:2970 Rrightarrow:21DB Rscr:211B Rsh:21B1 RuleDelayed:29F4 SHCHcy:429 SHcy:428
  SOFTcy:42C Sacute:15A Scaron:160 Scedil:15E Scirc:15C Scy:421 Sc:2ABC Sfr:1D516
  ShortDownArrow:2193 ShortLeftArrow:2190 ShortRightArrow:2192 ShortUpArrow:2191 Sigma:3A3
  SmallCircle:2218 Sopf:1D54A Sqrt:221A SquareIntersection:2293 SquareSubsetEqual:2291
  SquareSubset:228F SquareSupersetEqual:2292 SquareSuperset:2290 SquareUnion:2294 Square:25A1
  Sscr:1D4AE Star:22C6 SubsetEqual:2286 Subset:22D0 Sub:22D0 SucceedsEqual:2AB0
  SucceedsSlantEqual:227D SucceedsTilde:227F Succeeds:227B SuchThat:220B Sum:2211
  SupersetEqual:2287 Superset:2283 Supset:22D1 Sup:22D1 *THORN:DE TRADE:2122 TSHcy:40B TScy:426
  Tab:9 Tau:3A4 Tcaron:164 Tcedil:162 Tcy:422 Tfr:1D517 Therefore:2234 Theta:398
  ThickSpace:205F+200A ThinSpace:2009 TildeEqual:2243 TildeFullEqual:2245 TildeTilde:2248
  Tilde:223C Topf:1D54B TripleDot:20DB Tscr:1D4AF Tstrok:166 *Uacute:DA Uarrocir:2949 Uarr:219F
  Ubrcy:40E Ubreve:16C *Ucirc:DB Ucy:423 Udblac:170 Ufr:1D518 *Ugrave:D9 Umacr:16A UnderBar:5F
  UnderBrace:23DF UnderBracket:23B5 UnderParenthesis:23DD UnionPlus:228E Union:22C3 Uogon:172
  Uopf:1D54C UpArrowBar:2912 UpArrowDownArrow:21C5 UpArrow:2191 UpDownArrow:2195
  UpEquilibrium:296E UpTeeArrow:21A5 UpTee:22A5 Uparrow:21D1 Updownarrow:21D5 UpperLeftArrow:2196
  UpperRightArrow:2197 Upsilon:3A5 Upsi:3D2 Uring:16E Uscr:1D4B0 Utilde:168 *Uuml:DC VDash:22AB
  Vbar:2AEB Vcy:412 Vdashl:2AE6 Vdash:22A9 Vee:22C1 Verbar:2016 VerticalBar:2223 VerticalLine:7C
  VerticalSeparator:2758 VerticalTilde:2240 Vert:2016 VeryThinSpace:200A Vfr:1D519 Vopf:1D54D
  Vscr:1D4B1 Vvdash:22AA Wcirc:174 Wedge:22C0 Wfr:1D51A Wopf:1D54E Wscr:1D4B2 Xfr:1D51B Xi:39E
  Xopf:1D54F Xscr:1D4B3 YAcy:42F YIcy:407 YUcy:42E *Yacute:DD Ycirc:176 Ycy:42B Yfr:1D51C
  Yopf:1D550 Yscr:1D4B4 Yuml:178 ZHcy:416 Zacute:179 Zcaron:17D Zcy:417 Zdot:17B
  ZeroWidthSpace:200B Zeta:396 Zfr:2128 Zopf:2124 Zscr:1D4B5 *aacute:E1 abreve:103 acE:223E+333
  acd:223F *acirc:E2 *acute:B4 acy:430 ac:223E *aelig:E6 afr:1D51E af:2061 *agrave:E0 alefsym:2135
  aleph:2135 alpha:3B1 amacr:101 amalg:2A3F *amp:26 andand:2A55 andd:2A5C andslope:2A58 andv:2A5A
  and:2227 ange:29A4 angle:2220 angmsdaa:29A8 angmsdab:29A9 angmsdac:29AA angmsdad:29AB
  angmsdae:29AC angmsdaf:29AD angmsdag:29AE angmsdah:29AF angmsd:2221 angrtvbd:299D angrtvb:22BE
  angrt:221F angsph:2222 angst:C5 angzarr:237C ang:2220 aogon:105 aopf:1D552 apE:2A70 apacir:2A6F
  ape:224A apid:224B apos:27 approxeq:224A approx:2248 ap:2248 *aring:E5 ascr:1D4B6 ast:2A
  asympeq:224D asymp:2248 *atilde:E3 *auml:E4 awconint:2233 awint:2A11 bNot:2AED backcong:224C
  backepsilon:3F6 backprime:2035 backsimeq:22CD backsim:223D barvee:22BD barwedge:2305 barwed:2305
  bbrktbrk:23B6 bbrk:23B5 bcong:224C bcy:431 bdquo:201E because:2235 becaus:2235 bemptyv:29B0
  bepsi:3F6 bernou:212C beta:3B2 beth:2136 between:226C bfr:1D51F bigcap:22C2 bigcirc:25EF
  bigcup:22C3 bigodot:2A00 bigoplus:2A01 bigotimes:2A02 bigsqcup:2A06 bigstar:2605
  bigtriangledown:25BD bigtriangleup:25B3 biguplus:2A04 bigvee:22C1 bigwedge:22C0 bkarow:290D
  blacklozenge:29EB blacksquare:25AA blacktriangledown:25BE blacktriangleleft:25C2
  blacktriangleright:25B8 blacktriangle:25B4 blank:2423 blk12:2592 blk14:2591 blk34:2593
  block:2588 bnequiv:2261+20E5 bne:3D+20E5 bnot:2310 bopf:1D553 bottom:22A5 bot:22A5 bowtie:22C8
  boxDL:2557 boxDR:2554 boxDl:2556 boxDr:2553 boxHD:2566 boxHU:2569 boxHd:2564 boxHu:2567
  boxH:2550 boxUL:255D boxUR:255A boxUl:255C boxUr:2559 boxVH:256C boxVL:2563 boxVR:2560
  boxVh:256B boxVl:2562 boxVr:255F boxV:2551 boxbox:29C9 boxdL:2555 boxdR:2552 boxdl:2510
  boxdr:250C boxhD:2565 boxhU:2568 boxhd:252C boxhu:2534 boxh:2500 boxminus:229F boxplus:229E
  boxtimes:22A0 boxuL:255B boxuR:2558 boxul:2518 boxur:2514 boxvH:256A boxvL:2561 boxvR:255E
  boxvh:253C boxvl:2524 boxvr:251C boxv:2502 bprime:2035 breve:2D8 *brvbar:A6 bscr:1D4B7
  bsemi:204F bsime:22CD bsim:223D bsolb:29C5 bsolhsub:27C8 bsol:5C bullet:2022 bull:2022
  bumpE:2AAE bumpeq:224F bumpe:224F bump:224E cacute:107 capand:2A44 capbrcup:2A49 capcap:2A4B
  capcup:2A47 capdot:2A40 caps:2229+FE00 cap:2229 caret:2041 caron:2C7 ccaps:2A4D ccaron:10D
  *ccedil:E7 ccirc:109 ccupssm:2A50 ccups:2A4C cdot:10B *cedil:B8 cemptyv:29B2 centerdot:B7
  *cent:A2 cfr:1D520 chcy:447 checkmark:2713 check:2713 chi:3C7 cirE:29C3 circeq:2257
  circlearrowleft:21BA circlearrowright:21BB circledR:AE circledS:24C8 circledast:229B
  circledcirc:229A circleddash:229D circ:2C6 cire:2257 cirfnint:2A10 cirmid:2AEF cirscir:29C2
  cir:25CB clubsuit:2663 clubs:2663 coloneq:2254 colone:2254 colon:3A commat:40 comma:2C
  compfn:2218 complement:2201 complexes:2102 comp:2201 congdot:2A6D cong:2245 conint:222E
  copf:1D554 coprod:2210 copysr:2117 *copy:A9 crarr:21B5 cross:2717 cscr:1D4B8 csube:2AD1
  csub:2ACF csupe:2AD2 csup:2AD0 ctdot:22EF cudarrl:2938 cudarrr:2935 cuepr:22DE cuesc:22DF
  cularrp:293D cularr:21B6 cupbrcap:2A48 cupcap:2A46 cupcup:2A4A cupdot:228D cupor:2A45
  cups:222A+FE00 cup:222A curarrm:293C curarr:21B7 curlyeqprec:22DE curlyeqsucc:22DF curlyvee:22CE
  curlywedge:22CF *curren:A4 curvearrowleft:21B6 curvearrowright:21B7 cuvee:22CE cuwed:22CF
  cwconint:2232 cwint:2231 cylcty:232D dArr:21D3 dHar:2965 dagger:2020 daleth:2138 darr:2193
  dashv:22A3 dash:2010 dbkarow:290F dblac:2DD dcaron:10F dcy:434 ddagger:2021 ddarr:21CA
  ddotseq:2A77 dd:2146 *deg:B0 delta:3B4 demptyv:29B1 dfisht:297F dfr:1D521 dharl:21C3 dharr:21C2
  diamondsuit:2666 diamond:22C4 diams:2666 diam:22C4 die:A8 digamma:3DD disin:22F2
  divideontimes:22C7 *divide:F7 divonx:22C7 div:F7 djcy:452 dlcorn:231E dlcrop:230D dollar:24
  dopf:1D555 doteqdot:2251 doteq:2250 dotminus:2238 dotplus:2214 dotsquare:22A1 dot:2D9
  doublebarwedge:2306 downarrow:2193 downdownarrows:21CA downharpoonleft:21C3
  downharpoonright:21C2 drbkarow:2910 drcorn:231F drcrop:230C dscr:1D4B9 dscy:455 dsol:29F6
  dstrok:111 dtdot:22F1 dtrif:25BE dtri:25BF duarr:21F5 duhar:296F dwangle:29A6 dzcy:45F
  dzigrarr:27FF eDDot:2A77 eDot:2251 *eacute:E9 easter:2A6E ecaron:11B *ecirc:EA ecir:2256
  ecolon:2255 ecy:44D edot:117 ee:2147 efDot:2252 efr:1D522 *egrave:E8 egsdot:2A98 egs:2A96
  eg:2A9A elinters:23E7 ell:2113 elsdot:2A97 els:2A95 el:2A99 emacr:113 emptyset:2205 emptyv:2205
  empty:2205 emsp13:2004 emsp14:2005 emsp:2003 eng:14B ensp:2002 eogon:119 eopf:1D556 eparsl:29E3
  epar:22D5 eplus:2A71 epsilon:3B5 epsiv:3F5 epsi:3B5 eqcirc:2256 eqcolon:2255 eqsim:2242
  eqslantgtr:2A96 eqslantless:2A95 equals:3D equest:225F equivDD:2A78 equiv:2261 eqvparsl:29E5
  erDot:2253 erarr:2971 escr:212F esdot:2250 esim:2242 eta:3B7 *eth:F0 *euml:EB euro:20AC excl:21
  exist:2203 expectation:2130 exponentiale:2147 fallingdotseq:2252 fcy:444 female:2640 ffilig:FB03
  fflig:FB00 ffllig:FB04 ffr:1D523 filig:FB01 fjlig:66+6A flat:266D fllig:FB02 fltns:25B1 fnof:192
  fopf:1D557 forall:2200 forkv:2AD9 fork:22D4 fpartint:2A0D *frac12:BD frac13:2153 *frac14:BC
  frac15:2155 frac16:2159 frac18:215B frac23:2154 frac25:2156 *frac34:BE frac35:2157 frac38:215C
  frac45:2158 frac56:215A frac58:215D frac78:215E frasl:2044 frown:2322 fscr:1D4BB gEl:2A8C
  gE:2267 gacute:1F5 gammad:3DD gamma:3B3 gap:2A86 gbreve:11F gcirc:11D gcy:433 gdot:121 gel:22DB
  geqq:2267 geqslant:2A7E geq:2265 gescc:2AA9 gesdotol:2A84 gesdoto:2A82 gesdot:2A80 gesles:2A94
  gesl:22DB+FE00 ges:2A7E ge:2265 gfr:1D524 ggg:22D9 gg:226B gimel:2137 gjcy:453 glE:2A92 gla:2AA5
  glj:2AA4 gl:2277 gnE:2269 gnapprox:2A8A gnap:2A8A gneqq:2269 gneq:2A88 gne:2A88 gnsim:22E7
  gopf:1D558 grave:60 gscr:210A gsime:2A8E gsiml:2A90 gsim:2273 gtcc:2AA7 gtcir:2A7A gtdot:22D7
  gtlPar:2995 gtquest:2A7C gtrapprox:2A86 gtrarr:2978 gtrdot:22D7 gtreqless:22DB gtreqqless:2A8C
  gtrless:2277 gtrsim:2273 *gt:3E gvertneqq:2269+FE00 gvnE:2269+FE00 hArr:21D4 hairsp:200A half:BD
  hamilt:210B hardcy:44A harrcir:2948 harrw:21AD harr:2194 hbar:210F hcirc:125 heartsuit:2665
  hearts:2665 hellip:2026 hercon:22B9 hfr:1D525 hksearow:2925 hkswarow:2926 hoarr:21FF homtht:223B
  hookleftarrow:21A9 hookrightarrow:21AA hopf:1D559 horbar:2015 hscr:1D4BD hslash:210F hstrok:127
  hybull:2043 hyphen:2010 *iacute:ED *icirc:EE icy:438 ic:2063 iecy:435 *iexcl:A1 iff:21D4
  ifr:1D526 *igrave:EC iiiint:2A0C iiint:222D iinfin:29DC iiota:2129 ii:2148 ijlig:133 imacr:12B
  image:2111 imagline:2110 imagpart:2111 imath:131 imof:22B7 imped:1B5 incare:2105 infintie:29DD
  infin:221E inodot:131 intcal:22BA integers:2124 intercal:22BA intlarhk:2A17 intprod:2A3C
  int:222B in:2208 iocy:451 iogon:12F iopf:1D55A iota:3B9 iprod:2A3C *iquest:BF iscr:1D4BE
  isinE:22F9 isindot:22F5 isinsv:22F3 isins:22F4 isinv:2208 isin:2208 itilde:129 it:2062 iukcy:456
  *iuml:EF jcirc:135 jcy:439 jfr:1D527 jmath:237 jopf:1D55B jscr:1D4BF jsercy:458 jukcy:454
  kappav:3F0 kappa:3BA kcedil:137 kcy:43A kfr:1D528 kgreen:138 khcy:445 kjcy:45C kopf:1D55C
  kscr:1D4C0 lAarr:21DA lArr:21D0 lAtail:291B lBarr:290E lEg:2A8B lE:2266 lHar:2962 lacute:13A
  laemptyv:29B4 lagran:2112 lambda:3BB langd:2991 langle:27E8 lang:27E8 lap:2A85 *laquo:AB
  larrbfs:291F larrb:21E4 larrfs:291D larrhk:21A9 larrlp:21AB larrpl:2939 larrsim:2973 larrtl:21A2
  larr:2190 latail:2919 lates:2AAD+FE00 late:2AAD lat:2AAB lbarr:290C lbbrk:2772 lbrace:7B
  lbrack:5B lbrke:298B lbrksld:298F lbrkslu:298D lcaron:13E lcedil:13C lceil:2308 lcub:7B lcy:43B
  ldca:2936 ldquor:201E ldquo:201C ldrdhar:2967 ldrushar:294B ldsh:21B2 leftarrowtail:21A2
  leftarrow:2190 leftharpoondown:21BD leftharpoonup:21BC leftleftarrows:21C7 leftrightarrows:21C6
  leftrightarrow:2194 leftrightharpoons:21CB leftrightsquigarrow:21AD leftthreetimes:22CB leg:22DA
  leqq:2266 leqslant:2A7D leq:2264 lescc:2AA8 lesdotor:2A83 lesdoto:2A81 lesdot:2A7F lesges:2A93
  lesg:22DA+FE00 lessapprox:2A85 lessdot:22D6 lesseqgtr:22DA lesseqqgtr:2A8B lessgtr:2276
  lesssim:2272 les:2A7D le:2264 lfisht:297C lfloor:230A lfr:1D529 lgE:2A91 lg:2276 lhard:21BD
  lharul:296A lharu:21BC lhblk:2584 ljcy:459 llarr:21C7 llcorner:231E llhard:296B lltri:25FA
  ll:226A lmidot:140 lmoustache:23B0 lmoust:23B0 lnE:2268 lnapprox:2A89 lnap:2A89 lneqq:2268
  lneq:2A87 lne:2A87 lnsim:22E6 loang:27EC loarr:21FD lobrk:27E6 longleftarrow:27F5
  longleftrightarrow:27F7 longmapsto:27FC longrightarrow:27F6 looparrowleft:21AB
  looparrowright:21AC lopar:2985 lopf:1D55D loplus:2A2D lotimes:2A34 lowast:2217 lowbar:5F
  lozenge:25CA lozf:29EB loz:25CA lparlt:2993 lpar:28 lrarr:21C6 lrcorner:231F lrhard:296D
  lrhar:21CB lrm:200E lrtri:22BF lsaquo:2039 lscr:1D4C1 lsh:21B0 lsime:2A8D lsimg:2A8F lsim:2272
  lsqb:5B lsquor:201A lsquo:2018 lstrok:142 ltcc:2AA6 ltcir:2A79 ltdot:22D6 lthree:22CB
  ltimes:22C9 ltlarr:2976 ltquest:2A7B ltrPar:2996 ltrie:22B4 ltrif:25C2 ltri:25C3 *lt:3C
  lurdshar:294A luruhar:2966 lvertneqq:2268+FE00 lvnE:2268+FE00 mDDot:223A *macr:AF male:2642
  maltese:2720 malt:2720 mapstodown:21A7 mapstoleft:21A4 mapstoup:21A5 mapsto:21A6 map:21A6
  marker:25AE mcomma:2A29 mcy:43C mdash:2014 measuredangle:2221 mfr:1D52A mho:2127 *micro:B5
  midast:2A midcir:2AF0 *middot:B7 mid:2223 minusb:229F minusdu:2A2A minusd:2238 minus:2212
  mlcp:2ADB mldr:2026 mnplus:2213 models:22A7 mopf:1D55E mp:2213 mscr:1D4C2 mstpos:223E
  multimap:22B8 mumap:22B8 mu:3BC nGg:22D9+338 nGtv:226B+338 nGt:226B+20D2 nLeftarrow:21CD
  nLeftrightarrow:21CE nLl:22D8+338 nLtv:226A+338 nLt:226A+20D2 nRightarrow:21CF nVDash:22AF
  nVdash:22AE nabla:2207 nacute:144 nang:2220+20D2 napE:2A70+338 napid:224B+338 napos:149
  napprox:2249 nap:2249 naturals:2115 natural:266E natur:266E *nbsp:A0 nbumpe:224F+338
  nbump:224E+338 ncap:2A43 ncaron:148 ncedil:146 ncongdot:2A6D+338 ncong:2247 ncup:2A42 ncy:43D
  ndash:2013 neArr:21D7 nearhk:2924 nearrow:2197 nearr:2197 nedot:2250+338 nequiv:2262 nesear:2928
  nesim:2242+338 nexists:2204 nexist:2204 ne:2260 nfr:1D52B ngE:2267+338 ngeqq:2267+338
  ngeqslant:2A7E+338 ngeq:2271 nges:2A7E+338 nge:2271 ngsim:2275 ngtr:226F ngt:226F nhArr:21CE
  nharr:21AE nhpar:2AF2 nisd:22FA nis:22FC niv:220B ni:220B njcy:45A nlArr:21CD nlE:2266+338
  nlarr:219A nldr:2025 nleftarrow:219A nleftrightarrow:21AE nleqq:2266+338 nleqslant:2A7D+338
  nleq:2270 nless:226E nles:2A7D+338 nle:2270 nlsim:2274 nltrie:22EC nltri:22EA nlt:226E nmid:2224
  nopf:1D55F notinE:22F9+338 notindot:22F5+338 notinva:2209 notinvb:22F7 notinvc:22F6 notin:2209
  notniva:220C notnivb:22FE notnivc:22FD notni:220C *not:AC nparallel:2226 nparsl:2AFD+20E5
  npart:2202+338 npar:2226 npolint:2A14 nprcue:22E0 npreceq:2AAF+338 nprec:2280 npre:2AAF+338
  npr:2280 nrArr:21CF nrarrc:2933+338 nrarrw:219D+338 nrarr:219B nrightarrow:219B nrtrie:22ED
  nrtri:22EB nsccue:22E1 nsce:2AB0+338 nscr:1D4C3 nsc:2281 nshortmid:2224 nshortparallel:2226
  nsimeq:2244 nsime:2244 nsim:2241 nsmid:2224 nspar:2226 nsqsube:22E2 nsqsupe:22E3 nsubE:2AC5+338
  nsube:2288 nsubseteqq:2AC5+338 nsubseteq:2288 nsubset:2282+20D2 nsub:2284 nsucceq:2AB0+338
  nsucc:2281 nsupE:2AC6+338 nsupe:2289 nsupseteqq:2AC6+338 nsupseteq:2289 nsupset:2283+20D2
  nsup:2285 ntgl:2279 *ntilde:F1 ntlg:2278 ntrianglelefteq:22EC ntriangleleft:22EA
  ntrianglerighteq:22ED ntriangleright:22EB numero:2116 numsp:2007 num:23 nu:3BD nvDash:22AD
  nvHarr:2904 nvap:224D+20D2 nvdash:22AC nvge:2265+20D2 nvgt:3E+20D2 nvinfin:29DE nvlArr:2902
  nvle:2264+20D2 nvltrie:22B4+20D2 nvlt:3C+20D2 nvrArr:2903 nvrtrie:22B5+20D2 nvsim:223C+20D2
  nwArr:21D6 nwarhk:2923 nwarrow:2196 nwarr:2196 nwnear:2927 oS:24C8 *oacute:F3 oast:229B
  *ocirc:F4 ocir:229A ocy:43E odash:229D odblac:151 odiv:2A38 odot:2299 odsold:29BC oelig:153
  ofcir:29BF ofr:1D52C ogon:2DB *ograve:F2 ogt:29C1 ohbar:29B5 ohm:3A9 oint:222E olarr:21BA
  olcir:29BE olcross:29BB oline:203E olt:29C0 omacr:14D omega:3C9 omicron:3BF omid:29B6
  ominus:2296 oopf:1D560 opar:29B7 operp:29B9 oplus:2295 orarr:21BB orderof:2134 order:2134
  *ordf:AA *ordm:BA ord:2A5D origof:22B6 oror:2A56 orslope:2A57 orv:2A5B or:2228 oscr:2134
  *oslash:F8 osol:2298 *otilde:F5 otimesas:2A36 otimes:2297 *ouml:F6 ovbar:233D parallel:2225
  *para:B6 parsim:2AF3 parsl:2AFD part:2202 par:2225 pcy:43F percnt:25 period:2E permil:2030
  perp:22A5 pertenk:2031 pfr:1D52D phiv:3D5 phi:3C6 phmmat:2133 phone:260E pitchfork:22D4 piv:3D6
  pi:3C0 planckh:210E planck:210F plankv:210F plusacir:2A23 plusb:229E pluscir:2A22 plusdo:2214
  plusdu:2A25 pluse:2A72 *plusmn:B1 plussim:2A26 plustwo:2A27 plus:2B pm:B1 pointint:2A15
  popf:1D561 *pound:A3 prE:2AB3 prap:2AB7 prcue:227C precapprox:2AB7 preccurlyeq:227C preceq:2AAF
  precnapprox:2AB9 precneqq:2AB5 precnsim:22E8 precsim:227E prec:227A pre:2AAF primes:2119
  prime:2032 prnE:2AB5 prnap:2AB9 prnsim:22E8 prod:220F profalar:232E profline:2312 profsurf:2313
  propto:221D prop:221D prsim:227E prurel:22B0 pr:227A pscr:1D4C5 psi:3C8 puncsp:2008 qfr:1D52E
  qint:2A0C qopf:1D562 qprime:2057 qscr:1D4C6 quaternions:210D quatint:2A16 questeq:225F quest:3F
  *quot:22 rAarr:21DB rArr:21D2 rAtail:291C rBarr:290F rHar:2964 race:223D+331 racute:155
  radic:221A raemptyv:29B3 rangd:2992 range:29A5 rangle:27E9 rang:27E9 *raquo:BB rarrap:2975
  rarrbfs:2920 rarrb:21E5 rarrc:2933 rarrfs:291E rarrhk:21AA rarrlp:21AC rarrpl:2945 rarrsim:2974
  rarrtl:21A3 rarrw:219D rarr:2192 ratail:291A rationals:211A ratio:2236 rbarr:290D rbbrk:2773
  rbrace:7D rbrack:5D rbrke:298C rbrksld:298E rbrkslu:2990 rcaron:159 rcedil:157 rceil:2309
  rcub:7D rcy:440 rdca:2937 rdldhar:2969 rdquor:201D rdquo:201D rdsh:21B3 realine:211B
  realpart:211C reals:211D real:211C rect:25AD *reg:AE rfisht:297D rfloor:230B rfr:1D52F
  rhard:21C1 rharul:296C rharu:21C0 rhov:3F1 rho:3C1 rightarrowtail:21A3 rightarrow:2192
  rightharpoondown:21C1 rightharpoonup:21C0 rightleftarrows:21C4 rightleftharpoons:21CC
  rightrightarrows:21C9 rightsquigarrow:219D rightthreetimes:22CC ring:2DA risingdotseq:2253
  rlarr:21C4 rlhar:21CC rlm:200F rmoustache:23B1 rmoust:23B1 rnmid:2AEE roang:27ED roarr:21FE
  robrk:27E7 ropar:2986 ropf:1D563 roplus:2A2E rotimes:2A35 rpargt:2994 rpar:29 rppolint:2A12
  rrarr:21C9 rsaquo:203A rscr:1D4C7 rsh:21B1 rsqb:5D rsquor:2019 rsquo:2019 rthree:22CC
  rtimes:22CA rtrie:22B5 rtrif:25B8 rtriltri:29CE rtri:25B9 ruluhar:2968 rx:211E sacute:15B
  sbquo:201A scE:2AB4 scap:2AB8 scaron:161 sccue:227D scedil:15F sce:2AB0 scirc:15D scnE:2AB6
  scnap:2ABA scnsim:22E9 scpolint:2A13 scsim:227F scy:441 sc:227B sdotb:22A1 sdote:2A66 sdot:22C5
  seArr:21D8 searhk:2925 searrow:2198 searr:2198 *sect:A7 semi:3B seswar:2929 setminus:2216
  setmn:2216 sext:2736 sfrown:2322 sfr:1D530 sharp:266F shchcy:449 shcy:448 shortmid:2223
  shortparallel:2225 *shy:AD sigmaf:3C2 sigmav:3C2 sigma:3C3 simdot:2A6A simeq:2243 sime:2243
  simgE:2AA0 simg:2A9E simlE:2A9F siml:2A9D simne:2246 simplus:2A24 simrarr:2972 sim:223C
  slarr:2190 smallsetminus:2216 smashp:2A33 smeparsl:29E4 smid:2223 smile:2323 smtes:2AAC+FE00
  smte:2AAC smt:2AAA softcy:44C solbar:233F solb:29C4 sol:2F sopf:1D564 spadesuit:2660 spades:2660
  spar:2225 sqcaps:2293+FE00 sqcap:2293 sqcups:2294+FE00 sqcup:2294 sqsube:2291 sqsubseteq:2291
  sqsubset:228F sqsub:228F sqsupe:2292 sqsupseteq:2292 sqsupset:2290 sqsup:2290 square:25A1
  squarf:25AA squf:25AA squ:25A1 srarr:2192 sscr:1D4C8 ssetmn:2216 ssmile:2323 sstarf:22C6
  starf:2605 star:2606 straightepsilon:3F5 straightphi:3D5 strns:AF subE:2AC5 subdot:2ABD
  subedot:2AC3 sube:2286 submult:2AC1 subnE:2ACB subne:228A subplus:2ABF subrarr:2979
  subseteqq:2AC5 subseteq:2286 subsetneqq:2ACB subsetneq:228A subset:2282 subsim:2AC7 subsub:2AD5
  subsup:2AD3 sub:2282 succapprox:2AB8 succcurlyeq:227D succeq:2AB0 succnapprox:2ABA succneqq:2AB6
  succnsim:22E9 succsim:227F succ:227B sum:2211 sung:266A *sup1:B9 *sup2:B2 *sup3:B3 supE:2AC6
  supdot:2ABE supdsub:2AD8 supedot:2AC4 supe:2287 suphsol:27C9 suphsub:2AD7 suplarr:297B
  supmult:2AC2 supnE:2ACC supne:228B supplus:2AC0 supseteqq:2AC6 supseteq:2287 supsetneqq:2ACC
  supsetneq:228B supset:2283 supsim:2AC8 supsub:2AD4 supsup:2AD6 sup:2283 swArr:21D9 swarhk:2926
  swarrow:2199 swarr:2199 swnwar:292A *szlig:DF target:2316 tau:3C4 tbrk:23B4 tcaron:165
  tcedil:163 tcy:442 tdot:20DB telrec:2315 tfr:1D531 there4:2234 therefore:2234 thetasym:3D1
  thetav:3D1 theta:3B8 thickapprox:2248 thicksim:223C thinsp:2009 thkap:2248 thksim:223C *thorn:FE
  tilde:2DC timesbar:2A31 timesb:22A0 timesd:2A30 *times:D7 tint:222D toea:2928 topbot:2336
  topcir:2AF1 topfork:2ADA topf:1D565 top:22A4 tosa:2929 tprime:2034 trade:2122 triangledown:25BF
  trianglelefteq:22B4 triangleleft:25C3 triangleq:225C trianglerighteq:22B5 triangleright:25B9
  triangle:25B5 tridot:25EC trie:225C triminus:2A3A triplus:2A39 trisb:29CD tritime:2A3B
  trpezium:23E2 tscr:1D4C9 tscy:446 tshcy:45B tstrok:167 twixt:226C twoheadleftarrow:219E
  twoheadrightarrow:21A0 uArr:21D1 uHar:2963 *uacute:FA uarr:2191 ubrcy:45E ubreve:16D *ucirc:FB
  ucy:443 udarr:21C5 udblac:171 udhar:296E ufisht:297E ufr:1D532 *ugrave:F9 uharl:21BF uharr:21BE
  uhblk:2580 ulcorner:231C ulcorn:231C ulcrop:230F ultri:25F8 umacr:16B *uml:A8 uogon:173
  uopf:1D566 uparrow:2191 updownarrow:2195 upharpoonleft:21BF upharpoonright:21BE uplus:228E
  upsih:3D2 upsilon:3C5 upsi:3C5 upuparrows:21C8 urcorner:231D urcorn:231D urcrop:230E uring:16F
  urtri:25F9 uscr:1D4CA utdot:22F0 utilde:169 utrif:25B4 utri:25B5 uuarr:21C8 *uuml:FC
  uwangle:29A7 vArr:21D5 vBarv:2AE9 vBar:2AE8 vDash:22A8 vangrt:299C varepsilon:3F5 varkappa:3F0
  varnothing:2205 varphi:3D5 varpi:3D6 varpropto:221D varrho:3F1 varr:2195 varsigma:3C2
  varsubsetneqq:2ACB+FE00 varsubsetneq:228A+FE00 varsupsetneqq:2ACC+FE00 varsupsetneq:228B+FE00
  vartheta:3D1 vartriangleleft:22B2 vartriangleright:22B3 vcy:432 vdash:22A2 veebar:22BB
  veeeq:225A vee:2228 vellip:22EE verbar:7C vert:7C vfr:1D533 vltri:22B2 vnsub:2282+20D2
  vnsup:2283+20D2 vopf:1D567 vprop:221D vrtri:22B3 vscr:1D4CB vsubnE:2ACB+FE00 vsubne:228A+FE00
  vsupnE:2ACC+FE00 vsupne:228B+FE00 vzigzag:299A wcirc:175 wedbar:2A5F wedgeq:2259 wedge:2227
  weierp:2118 wfr:1D534 wopf:1D568 wp:2118 wreath:2240 wr:2240 wscr:1D4CC xcap:22C2 xcirc:25EF
  xcup:22C3 xdtri:25BD xfr:1D535 xhArr:27FA xharr:27F7 xi:3BE xlArr:27F8 xlarr:27F5 xmap:27FC
  xnis:22FB xodot:2A00 xopf:1D569 xoplus:2A01 xotime:2A02 xrArr:27F9 xrarr:27F6 xscr:1D4CD
  xsqcup:2A06 xuplus:2A04 xutri:25B3 xvee:22C1 xwedge:22C0 *yacute:FD yacy:44F ycirc:177 ycy:44B
  *yen:A5 yfr:1D536 yicy:457 yopf:1D56A yscr:1D4CE yucy:44E *yuml:FF zacute:17A zcaron:17E zcy:437
  zdot:17C zeetrf:2128 zeta:3B6 zfr:1D537 zhcy:436 zigrarr:21DD zopf:1D56B zscr:1D4CF zwj:200D
  zwnj:200C
`;

/**
 * `NAMED`, read once on first use: each name, without its `;`, and the text
 * it stands for; and which of them are legacy.
 */
let named: { texts: ReadonlyMap<string, string>; legacy: ReadonlySet<string> } | undefined;

function namedReferences(): NonNullable<typeof named> {
  if (named === undefined) {
    const texts = new Map<string, string>();
    const legacy = new Set<string>();
    for (const entry of NAMED.trim().split(/\s+/)) {
      const [marked, points] = entry.split(":") as [string, string];
      const name = marked.replace(/^\*/, "");
      texts.set(name, String.fromCodePoint(...points.split("+").map((point) => parseInt(point, 16))));
      if (marked !== name) {
        legacy.add(name);
      }
    }
    named = { texts, legacy };
  }
  return named;
}

/**
 * Where a reference is read, which decides one rule: in an attribute value,
 * a legacy name with no `;` that runs on into a letter, a digit or `=` is
 * left as written (`?a&ampx=1`), so that a URL's query survives.
 */
export type ReferenceContext = "text" | "attribute";

/**
 * The text `&` followed by `word` (a run of ASCII letters and digits) and,
 * when `semicolon`, a `;` draws, `next` being the character after it: the
 * name whole if it is one, else the longest legacy name it starts with
 * followed by the rest as written, else all of it as written — the
 * standard's "named character reference state".
 */
function resolveNamed(word: string, semicolon: boolean, next: string, context: ReferenceContext): string {
  const written = `&${word}${semicolon ? ";" : ""}`;
  const { texts, legacy } = namedReferences();
  const whole = texts.get(word);
  if (whole !== undefined && semicolon) {
    return whole;
  }
  for (let length = word.length; length > 0; length--) {
    const prefix = word.slice(0, length);
    if (legacy.has(prefix)) {
      const after = length < word.length ? word[length]! : semicolon ? ";" : next;
      return context === "attribute" && /^[A-Za-z0-9=]$/.test(after)
        ? written
        : texts.get(prefix)! + written.slice(1 + length);
    }
  }
  return written;
}

/**
 * Mermaid's entity codes in `text` as the character references Mermaid
 * hands the browser: `#name;` as `&name;`, and `#NN;` as `&#NN;` — its own
 * `/#\w+;/` rewrite, so a code is a word character run (`#a-b;` is not one).
 */
export function entityCodesAsReferences(text: string): string {
  return text.replace(/#(\w+);/g, (_, name: string) => (/^\d+$/.test(name) ? `&#${name};` : `&${name};`));
}

/**
 * `text` with each of Mermaid's entity codes in it resolved, and nothing
 * else: what the browser makes of a code Mermaid rewrote in markup whose
 * other text it had escaped, as it does sequence text.
 */
export function resolveEntityCodes(text: string): string {
  return text.replace(/#\w+;/g, (code) => resolveCharacterReferences(entityCodesAsReferences(code), "text"));
}

/**
 * `text` with each character reference in it resolved, as the browser's
 * parser resolves it in `context`: a number, in decimal or in hex after an
 * `x`, with or without its `;` (`&#65` is `A`); a name by `resolveNamed`;
 * and an `&` that starts neither left as it is.
 */
export function resolveCharacterReferences(text: string, context: ReferenceContext): string {
  return text.replace(
    /&(?:#(?:[xX]([0-9A-Fa-f]+)|(\d+));?|([A-Za-z0-9]+)(;?))/g,
    (
      reference: string,
      hex: string | undefined,
      decimal: string | undefined,
      word: string | undefined,
      semicolon: string | undefined,
      at: number,
    ) =>
      hex !== undefined
        ? numbered(parseInt(hex, 16))
        : decimal !== undefined
          ? numbered(Number(decimal))
          : resolveNamed(word!, semicolon === ";", text.charAt(at + reference.length), context),
  );
}

/**
 * What the HTML parser makes of 128–159 in a numeric reference: the
 * windows-1252 character at that byte, where it has one; the rest are kept.
 */
const WINDOWS_1252: Readonly<Record<number, number>> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/**
 * The character a numeric reference to `value` draws: the HTML standard's
 * "numeric character reference end state" — no character (0), a surrogate
 * or a number past Unicode is the replacement character.
 */
function numbered(value: number): string {
  if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
    return "\uFFFD";
  }
  return String.fromCodePoint(WINDOWS_1252[value] ?? value);
}
