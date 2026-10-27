import {
  MediaRequestStatus,
  type MediaSeason,
  MediaStatus,
  type TvDetails,
} from "./types";

/** The status icon standing for each of Seerr's season badges. */
const BADGE_STATUS: Record<SeasonBadge, MediaStatus> = {
  not_requested: MediaStatus.UNKNOWN,
  pending: MediaStatus.PENDING,
  // Approved and on its way, which Seerr calls "Requested".
  requested: MediaStatus.PROCESSING,
  partially_available: MediaStatus.PARTIALLY_AVAILABLE,
  available: MediaStatus.AVAILABLE,
};

/**
 * Every season of a series with where it stands, as a status icon reads it.
 *
 * Read the way Seerr reads its request table (see seasonRows): the library
 * first, unless it lost the season, then a request that still stands. A
 * request speaks in `MediaRequestStatus`, numbered differently from the
 * library's `MediaStatus`: read as a library status, a pending request (1)
 * meant "unknown", and the season offered itself to be requested again.
 */
export const seasonsWithStatus = (details: TvDetails) => {
  const rows = new Map(
    seasonRows(details, { specials: true }).map((row) => [
      row.seasonNumber,
      row,
    ]),
  );

  return details.seasons.map((season) => {
    const row = rows.get(season.seasonNumber);
    return {
      ...season,
      status: row ? seasonRowStatus(row) : MediaStatus.UNKNOWN,
    };
  });
};

/**
 * The status a season row stands for, as its status icon draws it, in the
 * season list and in the request sheet alike.
 */
export const seasonRowStatus = (row: SeasonRow): MediaStatus =>
  row.badge
    ? BADGE_STATUS[row.badge]
    : // No badge, as for a failed request: it stands, so not to ask again.
      row.locked
      ? MediaStatus.PENDING
      : MediaStatus.UNKNOWN;

/*
 * Which seasons of a series can still be requested, and how a selection of
 * them changes, as Seerr's own request modal has it (TvRequestModal:
 * getAllSeasons, getAllRequestedSeasons, toggleSeason, toggleAllSeasons), so
 * that asking for seasons works the same in the app as on Seerr's site.
 */

/** A user's series quota, as `GET /user/{id}/quota` gives it. */
export interface SeasonQuota {
  limit?: number;
  remaining?: number;
}

// What stands in the library: a season the library has lost can be asked for again.
const IN_LIBRARY = new Set([
  MediaStatus.AVAILABLE,
  MediaStatus.PARTIALLY_AVAILABLE,
  MediaStatus.PROCESSING,
]);

/** A season's library status for the tier's copy, standard or 4K. */
const seasonStatus = (season: MediaSeason, is4k: boolean): MediaStatus =>
  is4k ? season.status4k : season.status;

/** The tier's requests that still stand: not declined, not long completed. */
const standingRequests = (details: TvDetails, is4k: boolean) =>
  (details.mediaInfo?.requests ?? []).filter(
    (request) =>
      !!request.is4k === is4k &&
      request.status !== MediaRequestStatus.DECLINED &&
      request.status !== MediaRequestStatus.COMPLETED,
  );

/**
 * Seasons already asked for and still standing, or already in the library,
 * in the tier asked about.
 */
const requestedSeasons = (details: TvDetails, is4k: boolean): Set<number> => {
  const asked = standingRequests(details, is4k).flatMap((request) =>
    (request.seasons ?? []).map((season) => season.seasonNumber),
  );
  const inLibrary = (details.mediaInfo?.seasons ?? [])
    .filter((season) => IN_LIBRARY.has(seasonStatus(season, is4k)))
    .map((season) => season.seasonNumber);

  return new Set([...asked, ...inLibrary]);
};

/**
 * The seasons that can be requested: those with episodes, the specials only
 * when the server shows them, and none that is requested or in the library,
 * in standard or, for a 4K request, in 4K.
 */
export const unrequestedSeasons = (
  details: TvDetails,
  {
    specials = false,
    is4k = false,
  }: { specials?: boolean; is4k?: boolean } = {},
): number[] => {
  const requested = requestedSeasons(details, is4k);

  return details.seasons
    .filter(
      (season) =>
        season.episodeCount !== 0 &&
        (specials || season.seasonNumber > 0) &&
        !requested.has(season.seasonNumber),
    )
    .map((season) => season.seasonNumber);
};

/** Whether the quota leaves room to switch on one more season. */
export const roomForOneMore = (
  selected: number[],
  quota?: SeasonQuota,
): boolean => !quota?.limit || (quota.remaining ?? 0) - selected.length > 0;

/**
 * Whether the seasons switched on fit the quota. They can stop fitting once
 * the quota changes under them, when another user is picked in Request as or
 * a request made elsewhere spends it; Seerr then refuses the whole request.
 */
export const withinQuota = (selected: number[], quota?: SeasonQuota): boolean =>
  !quota?.limit || selected.length <= (quota.remaining ?? 0);

/** Whether the quota covers every season that can still be requested. */
export const roomForAll = (
  unrequested: number[],
  quota?: SeasonQuota,
): boolean => !quota?.limit || (quota.remaining ?? 0) >= unrequested.length;

/** Adds or takes out a season, within what can be requested and the quota. */
export const toggleSeason = (
  selected: number[],
  seasonNumber: number,
  unrequested: number[],
  quota?: SeasonQuota,
): number[] => {
  if (!unrequested.includes(seasonNumber)) return selected;
  if (selected.includes(seasonNumber)) {
    return selected.filter((number) => number !== seasonNumber);
  }
  if (!roomForOneMore(selected, quota)) return selected;
  return [...selected, seasonNumber];
};

/**
 * Whether the button for all seasons selects them, rather than clearing them
 * once they all are. The specials count: Seerr's own switch leaves them out of
 * the state it shows (isAllSeasons) but not out of what it does
 * (toggleAllSeasons), and the button's label says what it does.
 */
export const selectsAll = (
  selected: number[],
  unrequested: number[],
): boolean => unrequested.some((season) => !selected.includes(season));

/**
 * Selects every season that can be requested, when the quota covers them all,
 * or clears them once they all are.
 */
export const toggleAllSeasons = (
  selected: number[],
  unrequested: number[],
  quota?: SeasonQuota,
): number[] => {
  if (!selectsAll(selected, unrequested)) return [];
  return roomForAll(unrequested, quota) ? unrequested : selected;
};

/** The badge Seerr puts on a season in its request table. */
export type SeasonBadge =
  | "not_requested"
  | "pending"
  | "requested"
  | "partially_available"
  | "available";

export interface SeasonRow {
  seasonNumber: number;
  episodeCount: number;
  /** None in the odd cases Seerr draws none, such as a failed request. */
  badge?: SeasonBadge;
  /** Already requested or in the library: the switch is on and stays on. */
  locked: boolean;
}

/**
 * The rows of Seerr's season table (TvRequestModal): the seasons with
 * episodes, the specials only when the server shows them, each with the
 * badge Seerr gives it and whether it can still be chosen. A 4K request reads
 * the 4K copy, as Seerr's 4K modal does.
 */
export const seasonRows = (
  details: TvDetails,
  {
    specials = false,
    is4k = false,
  }: { specials?: boolean; is4k?: boolean } = {},
): SeasonRow[] => {
  const standing = standingRequests(details, is4k);

  return details.seasons
    .filter(
      (season) =>
        season.episodeCount !== 0 && (specials || season.seasonNumber !== 0),
    )
    .map((season) => {
      const seasonRequest = standing
        .flatMap((request) => request.seasons ?? [])
        .find(
          (asked) =>
            asked.seasonNumber === season.seasonNumber &&
            asked.status !== MediaRequestStatus.COMPLETED,
        );
      const mediaSeason = details.mediaInfo?.seasons?.find(
        (known) =>
          known.seasonNumber === season.seasonNumber &&
          seasonStatus(known, is4k) !== MediaStatus.UNKNOWN &&
          seasonStatus(known, is4k) !== MediaStatus.DELETED,
      );
      const libraryStatus = mediaSeason && seasonStatus(mediaSeason, is4k);

      let badge: SeasonBadge | undefined;
      if (libraryStatus === MediaStatus.AVAILABLE) badge = "available";
      else if (libraryStatus === MediaStatus.PARTIALLY_AVAILABLE)
        badge = "partially_available";
      else if (
        libraryStatus === MediaStatus.PROCESSING ||
        (!mediaSeason && seasonRequest?.status === MediaRequestStatus.APPROVED)
      )
        badge = "requested";
      else if (
        !mediaSeason &&
        seasonRequest?.status === MediaRequestStatus.PENDING
      )
        badge = "pending";
      else if (!mediaSeason && !seasonRequest) badge = "not_requested";

      return {
        seasonNumber: season.seasonNumber,
        episodeCount: season.episodeCount,
        badge,
        locked: !!mediaSeason || !!seasonRequest,
      };
    });
};
