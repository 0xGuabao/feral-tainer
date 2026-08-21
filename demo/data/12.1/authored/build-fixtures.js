export const USER_VALIDATION_TALENT_CODE =
  "CcGADBD3hSPCL9Y9gz68WcKvMAAAAAAwgZwYmZmxstMPwyYbmZGzMDAAAAbgZzwYmBzYWGzMzYMDDAAAAAgBGAAAAmZZWmZmZWmZxsMzyGMz8AALmBDAgZGMzGGA";

// SimulationCraft's checked-in 12.1 MID1 Feral/Wildstalker profile. It is a
// real export string and intentionally differs from the user validation build.
export const SIMC_WILDSTALKER_TALENT_CODE =
  "CcGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAjZwMzMzMmtFPwyMbzYGzMDAAAALBzGMmZUzYWYmZGjZmZAAAAAAAGAAAABAz2MLNbzssBmZAWMDGAAzMAYA";

// Derived from the user fixture by moving the leaf Lunar Inspiration point to
// the early-tree Primal Wrath node. SimulationCraft 1210-01 accepts and runs
// this export string against WoW 12.1.0.69299.
export const PRIMAL_WRATH_TALENT_CODE =
  "CcGAAAAAAAAAAAAAAAAAAAAAAAAAAAAwgZwYmZmxsZeglx2MzMzMzAAAAwGY2MMmZwMmlxMzMGzwAAAAAAYgBAAAgZWmlZmZmlZWMLzssBzMPAwiZwAAYmBzshB";

export const SIMC_MID1_EQUIPPED_PROFILE = `druid="MID1_Druid_Feral_Wildstalker"
source=default
spec=feral
level=90
race=night_elf
role=attack
position=back
talents=${SIMC_WILDSTALKER_TALENT_CODE}
head=branches_of_the_luminous_bloom,id=250024,bonus_id=1808/13575/13575/13575/13575/13575/13575/13575/13575/13575/13575/13575/13575,ilevel=289,gem_id=240983,enchant_id=8017
neck=amulet_of_the_abyssal_hymn,id=250247,bonus_id=12806/13577/13668,ilevel=289,gem_id=240892/240892
shoulders=fallen_grunts_mantle,id=251092,bonus_id=4795,ilevel=289,enchant_id=8001
back=defiant_defenders_drape,id=260312,bonus_id=4795,ilevel=289
chest=trunk_of_the_luminous_bloom,id=250027,bonus_id=13575/13575/13575/13575/13575/13575/13575/13575/13575/13575/13575/13575,ilevel=289,enchant_id=7987
wrists=silvermoon_agents_deflectors,id=244576,bonus_id=1808/8790/8960/12214/12214/12214/12214/12214/12214/12214/12214/12384,ilevel=285,gem_id=240892,crafted_stats=32/49
hands=arbortenders_of_the_luminous_bloom,id=250025,bonus_id=13574/13574/13574/13574/13574/13574/13574/13574/13574/13574/13574/13574,ilevel=289
waist=scornscarred_shulkas_belt,id=249374,bonus_id=1808/4795,ilevel=289,gem_id=240892
legs=phloemwraps_of_the_luminous_bloom,id=250023,bonus_id=13575/13575/13575/13575/13575/13575/13575/13575/13575/13575/13575/13575,ilevel=289,enchant_id=8159
feet=canopy_walkers_footwraps,id=249382,ilevel=289,enchant_id=7993
finger1=eye_of_midnight,id=249920,bonus_id=40/12806/13335/13534,ilevel=289,gem_id=240892/240892,enchant_id=7967
finger2=loa_worshipers_band,id=251513,bonus_id=8960/8960/12066/12214/12214/9627,ilevel=285,gem_id=240892,enchant_id=7967
trinket1=algethar_puzzle_box,id=193701,ilevel=289
trinket2=gaze_of_the_alnseer,id=249343,ilevel=289
main_hand=roostwardens_bough,id=251077,ilevel=289,enchant_id=8039`;

export const BUILD_FIXTURES = Object.freeze({
  userValidation: Object.freeze({
    id: "feral-user-validation-4pc",
    label: "用户验证构筑（4 件套）",
    talentCode: USER_VALIDATION_TALENT_CODE,
    setBonuses: ["midnight_season_2_2pc", "midnight_season_2_4pc"],
    source: "user-provided",
  }),
  simcWildstalker: Object.freeze({
    id: "feral-simc-wildstalker-4pc",
    label: "SimC MID1 Wildstalker（4 件套）",
    talentCode: SIMC_WILDSTALKER_TALENT_CODE,
    setBonuses: ["midnight_season_2_2pc", "midnight_season_2_4pc"],
    source: "vendor/simc/profiles/MID1/MID1_Druid_Feral.simc",
  }),
  simcMid1Equipped: Object.freeze({
    id: "feral-simc-mid1-equipped",
    label: "SimC MID1 完整装备（4 件套/双饰品）",
    talentCode: SIMC_WILDSTALKER_TALENT_CODE,
    profileText: SIMC_MID1_EQUIPPED_PROFILE,
    setBonuses: [],
    source: "vendor/simc/profiles/MID1/MID1_Druid_Feral.simc (browser fixture subset)",
  }),
  primalWrath: Object.freeze({
    id: "feral-primal-wrath-4pc",
    label: "原始之怒多目标构筑（4 件套）",
    talentCode: PRIMAL_WRATH_TALENT_CODE,
    setBonuses: ["midnight_season_2_2pc", "midnight_season_2_4pc"],
    source: "derived-and-verified-with-simc-1210-01",
  }),
});
