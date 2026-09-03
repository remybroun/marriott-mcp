# 03 — Operation Signatures (safelist snapshot)

Captured from `__NEXT_DATA__.props.pageProps.operationSignatures` on
`https://www.marriott.com/search/findHotels.mi`, **2026-08-29**.

- Next.js `buildId`: `ovoAI8iaz-thwv4jVWr40`
- 61 operations

**These rotate on frontend redeploys.** Re-scrape rather than hardcode:

```js
JSON.parse(document.getElementById('__NEXT_DATA__').textContent)
  .props.pageProps.operationSignatures
```

Different pages expose different subsets — the homepage carries the `homepage` client's
operations, the search page carries the `shop` client's. `phoenixShopSuggestedPlacesQuery`
appears on both.

Send as: `graphql-operation-signature: <signature>`.

---

## Search — priced, dated (the ones you want)

| Operation | Signature |
|---|---|
| `phoenixShopDatedSearchByGeoQuery` | `46b57113564cd372d3105f7f86be3efdb1549f31a86028977a9b46e251966acd` |
| `phoenixShopDatedSearchByGeoFilterQuery` | `d4deca6aff6fb92c979c421f49da4c92ba92817e5cb79eea2196f5b9760ab4e2` |
| `phoenixShopDatedSearchByDestinationQuery` | `19936acf228edb1a7c43b0b5e2102ef9cbe7e79c0f8fadd0d03bada15f4a6c25` |
| `phoenixShopDatedSearchByDestinationFilterQuery` | `2f93e0de98e14e93449e86d932f7c499bdfd5a48f84dc641341547f5ad8f951f` |
| `phoenixShopDatedSearchByLocationSearchInputQuery` | `5c49105cb850cf9eb5e257f260a41818dedc7af5497083e2aef8141cea90e52f` |
| `phoenixShopDatedSearchByLocationSearchInputFilterQuery` | `7e7395d7afd310652705b2f1099839cb297367e76bd57878c7dd3b083afd34c3` |
| `phoenixShopDatedSearchPropertiesInfoByIDs` | `7ffa2c11e83eeecf903426455cb66fc43f87c882a93dab8dc89aeb54e9071cf2` |
| `phoenixShopDatedSearchPropertiesInfoByIDsFilter` | `4e8ea8c29f3ec36d4c6444c141b06aa0dc8f4c231a2b96d948c77558607e61ac` |

## Search — lowest available rates family

| Operation | Signature |
|---|---|
| `phoenixShopLowestAvailableRatesByGeoQuery` | `3994895be16cd3997b30c8fd377f4a009cbf5b69c9b1e3041ddeefdca9be5519` |
| `phoenixShopLowestAvailableRatesByGeoFilterQuery` | `2d246eba6a1fc42f84be65c2c8bf056ea8ec3141bb5ace6e922a885f6f036c83` |
| `phoenixShopLowestAvailableRatesByGeoQueryGetIDS` | `b5ff7ec46572efcd4002611cf257addde11ba1d65684029ec4f57eca617a59a6` |
| `phoenixShopLowestAvailableRatesByDestinationQuery` | `40f7691bc952d52837e148508106b613d4f7e243056f9eed81fa2e14947df5c1` |
| `phoenixShopLowestAvailableRatesByDestinationFilterQuery` | `6aa945e4502096e0d13fac044c65e59c506ece44808d47165850f7ba7c7ec494` |
| `phoenixShopLowestAvailableRatesByDestinationGetIDSQuery` | `28478ed80deebaf896c7956b23b9d694a25b3ccbf4ed26dac65891dba3887fd7` |
| `phoenixShopLowestAvailableRatesByKeywordQuery` | `ecd8488074eb8b4d5b1fa312761054b7fa068753a6e8bde4becd1d6cc0e14ded` |
| `phoenixShopLowestAvailableRatesByKeywordFilterQuery` | `fae5a6d43e5f538c4daa42f5449ecf8b407c625728390360935e18b45df611d8` |
| `phoenixShopLowestAvailableRatesGetIDSByKeyword` | `030793b788a498c7f10f73a07e69ec26963fc1b9909753bb2870325165ff7935` |
| `phoenixShopLowestAvailableRatesByLocationSearchInputQuery` | `7c8e3da39a8814dbc6b5af31d879458e5485b6cb50eec7d61b5af1b948adcc9a` |
| `phoenixShopLowestAvailableRatesByLocationSearchInputFilterQuery` | `4a855e6eddee59cd0aa890fd68466b9260d0f06178ac7c0ef5e63b10db832b08` |
| `phoenixShopLowestAvailableRatesByLocationSearchInputGetIDSQuery` | `f0624de679963e2a3722051b267e1e08827dbf11701cfaf64a5e4974118bd62d` |

## Search — non-dated / property listing

| Operation | Signature |
|---|---|
| `phoenixShopSearchPropertiesByGeoLocation` | `bea225a1df0a1546d3f0a18ac19b5f5cfe1b94fbead7cf0624e5d5dcef28419f` |
| `phoenixShopSearchPropertiesByGeoLocationFilter` | `cf7f80c49ed0ef6735ca9217f9d16308399e619ed7ec94eba9d5679936fedf07` |
| `phoenixShopSearchPropertiesByDestination` | `b2a337a12621508babd5b1491b5da036c3a65f85ef2dd121b0d948482bff62a5` |
| `phoenixShopSearchPropertiesByDestinationFilter` | `53f8cac7f4999832162f59a5b6d913a6e0449dd6458aa8e55633303199cb8071` |
| `phoenixShopSearchPropertiesByLocation` | `c78a29633455b0f24c902389af0dbabcda95b1e2d95e05522f3c7cec85d2c071` |
| `phoenixShopSearchPropertiesByLocationFilter` | `645b244a724a7f82a454471cf7d661968943c88cd1ad16d0f2dbbf5c0d371280` |
| `phoenixShopSearchPropertiesByLocationInput` | `8eedb64008c776bc2cae06ad44c2ae90fbc4fe3dbcf99d384ac300ab34a90a80` |
| `phoenixShopSearchPropertiesNonDatedAllInfoByIDs` | `e43b45b6d374773403875a000c302d437513e83c3e6f86fb83129797364b78c6` |
| `phoenixShopSearchPropertiesNonDatedFiltersByIDs` | `9ec6831d5b8e4478b99610e5d4a8ca5b8b44f2ec1e5b25cdc76e9e34fc7741e8` |
| `phoenixShopPropertiesByGeoLocation` | `ddb99616988ff09d5662b4003cf3f1213af66f9f90b16fc65e585270697abefb` |
| `phoenixShopPropertiesByGeoLocationFilter` | `25aeacb9886795af39606ffcf0239fe6d43ca0bc733e3a536cb31b7c9590c97d` |
| `phoenixShopPropertiesByGeoLocationGetIDS` | `8b7a4241e0ea348d6cacfe7778ee42afa0e5767b028fd114fa07c70440ce9381` |
| `phoenixShopPropertiesByDestination` | `6ad783d6dc3b52cf6935397e72c89db1f2557e182b07358a471cf0dc5e5d22a1` |
| `phoenixShopPropertiesByDestinationFilter` | `db1d86b6c84d545a598ddb1665b38ac4caa504815344ec9378e0da39f0fb69d9` |
| `phoenixShopPropertiesByDestinationGetIDS` | `208f053aefd3dad2b45aaec183f8fd607c606062f3942fdee7f4fb0c214473a5` |

## Property detail / hydration

| Operation | Signature |
|---|---|
| `phoenixShopPropertiesBasicInfoByIDS` | `4246f7b2b081c7876caeb12b967dddd3089ebd95363841a4be2cccab71c922ea` |
| `phoenixShopPropertiesDatedAllInfoByIDs` | `b863ded8527f75e4bc361b2f52e9d711b48cc6e215bb7e1a2f9fc0c87200cc43` |
| `phoenixShopPropertiesDatedFiltersByIDs` | `9695c25c4b0bcc68a6cf11914210f75d6279ca866c5f254eb28f7f042217335c` |
| `phoenixShopPropertiesNonDatedAllInfoByIDs` | `442c36c404d696809d0f2e4aa44440852d010e045be004017f5fe3cea15b4773` |
| `phoenixShopPropertiesNonDatedFiltersByIDs` | `bdcf5112d9be37b9fd137d1aa1a76c0c05ff1f3ca3714e855a0ad9bcb3c9bb77` |
| `phoenixShopPropertiesMediaGalleryByIDS` | `b0700ec76e8e70b31592b1ce10b05451711924c1506e51547e2871ef6b77cde4` |
| `phoenixShopPropertyInfoCall` | `00f8d18ee03321350caae9366a33f51b190bc80e760eb3d586260f31b902e843` |
| `phoenixShopHotelAmenities` | `77ebd1ceb8c4eafdb023fffbbc02524b7a4dc414152946846d30294d65115711` |
| `phoenixShopHotelDirectoryData` | `33ec83944fdab5025cb6e7720915280ff54b2f7503777a9e7986e564d426dade` |
| `phoenixShopHotelGalleryTitleRateOnly` | `2961e093ad56803d89a2632baa56b52da7237aca77d5f781e8c6e07fbcb62712` |

## Rooms & products (booking path)

| Operation | Signature |
|---|---|
| `phoenixShopSearchProductsByProperty` | `62cdb3e29fa195a8b27b15618990b7d9721d1b65145715d8f30b8a34dff3eeb3` |
| `phoenixShopADFSearchProductsByProperty` | `887375892e1ad2a43f46a9c95c55ea47cf6eca3af03331c2134f1b440cff3f9f` |
| `phoenixShopInventoryDate` | `c42369a18b6fa9ea6f59a9717169bfa37736809e006d3fced4d1e527d9fa82ff` |
| `phoenixShopAdvSearchInventoryDate` | `7d7f735313b7f2dda708c1c9b6dc51233434f78319639a70a0d8b20f508ca02b` |

`SearchProductsByProperty` is the room-and-rate-level call — the next thing to research
if the MCP needs per-room rates rather than a property's lowest rate.

## Quick View (HQV)

| Operation | Signature |
|---|---|
| `phoenixShopHQVPropertyInfoCall` | `d4eec435708414c81a2293d4990f71c8c44c47338da24b32547089516e028794` |
| `phoenixShopHQVRateOnly` | `68cdff5617743016fd5ceb21249c23ebee159d0d66b1e226b9b0b4269f2ab7a8` |
| `phoenixShopHQVPhotogalleryCall` | `db0d761c49558aadfb86728cdd67e50aa6dd5be802f78659a5efe7e079f04dd2` |

## Places / autocomplete

| Operation | Signature |
|---|---|
| `phoenixShopSuggestedPlacesQuery` | `70b3555c91797ca8945e4f4b1bdda42c3e37fa1f08fa99feafb73195702c1d34` |
| `phoenixShopSuggestedPlacesDetailsQuery` | `0b89c8ea7a6a6408eaee651983d6c7ee168670b727cc5beea980b2d2edfdbe2b` |

## Currency

| Operation | Signature |
|---|---|
| `phoenixShopADFConvertCurrencyQuery` | `7dc40e394809feb203c2cdf744245ca4a8ca9bc54cf863ed051c5cca6b217ae4` |
| `phoenixShopExchangeRateByCurrencyCodesQuery` | `0d4d2f3a765d179fb6c2b74d4811970ffef6859db8e431b45eba63fe94b26a3b` |

## Account / session (require auth)

| Operation | Signature |
|---|---|
| `phoenixShopCustomerToken` | `98d4f558a38555ed231ccddea3f5a6c076cacdd0be88b9812d8e3b9e8720d57b` |
| `phoenixShopUpdateCustomerSavedProperties` | `4b5e871ae7c477d04bb3b0e0f5414f4a464540a10bd1b3a7657a7f7f48a6eb87` |
| `PhoenixBookHotelHeaderData` | `2fa7a7f2ea17ad7ad9dcfde1414573294f48c5f4bbf0733a0f54f6a4d993da4f` |
| `PhoenixBookHotelHeaderDataAuth` | `56cafc03a7933eb94b78f220c3bf235b7bf6938640d54e548b165a2f1099cfcb` |
| `PhoenixBookUpdateSaveProperties` | `b0c0bb536606ce0380934f47ab04b8986298e9361ac485e4136adf7c0abb8df1` |
