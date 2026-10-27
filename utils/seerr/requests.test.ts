import { Permission } from "./permissions";
import {
  canRequest,
  canRequestForOthers,
  canRequestMore,
  defaultServerFor,
  requestOffer,
} from "./requests";
import {
  type MediaInfo,
  type MediaRequest,
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  type MovieDetails,
  type MovieResult,
  type ServiceCommonServer,
  type TvDetails,
  type TvResult,
  type User,
} from "./types";

const stamps = { createdAt: "2026-09-26", updatedAt: "2026-09-26" };

const someone: User = {
  id: 108,
  permissions: 0,
  displayName: "Someone",
  ...stamps,
};

// Neither title is known to Seerr yet, which is the case a request is for:
// no mediaInfo until someone asks or the library has it.
const newFilm: MovieResult = {
  id: 438631,
  mediaType: MediaType.MOVIE,
  title: "Dune",
};

const newSeries: TvResult = {
  id: 1399,
  mediaType: MediaType.TV,
  name: "Game of Thrones",
};

const filmDetails: MovieDetails = {
  id: 438631,
  title: "Dune",
  spokenLanguages: [],
  releases: {},
  keywords: [],
};

const known = (
  status: MediaStatus,
  requests: MediaRequest[] = [],
): MediaInfo => ({
  id: 1,
  tmdbId: 438631,
  status,
  mediaType: MediaType.MOVIE,
  requests,
});

const request = (status: MediaRequestStatus): MediaRequest => ({
  id: 7,
  status,
  media: known(MediaStatus.UNKNOWN),
  requestedBy: someone,
});

describe("canRequest", () => {
  // Read through mediaInfo, a title Seerr had never seen was always taken for
  // a series, so a film asked for the permission to request series.
  test("lets someone who may request films ask for a new film", () => {
    expect(canRequest(newFilm, Permission.REQUEST_MOVIE)).toBe(true);
    expect(canRequest(filmDetails, Permission.REQUEST_MOVIE)).toBe(true);
  });

  test("keeps someone who may only request series from asking for a film", () => {
    expect(canRequest(newFilm, Permission.REQUEST_TV)).toBe(false);
  });

  test("lets someone who may request series ask for a new series", () => {
    expect(canRequest(newSeries, Permission.REQUEST_TV)).toBe(true);
    expect(canRequest(newSeries, Permission.REQUEST_MOVIE)).toBe(false);
  });

  test("lets someone who may request anything ask for either", () => {
    expect(canRequest(newFilm, Permission.REQUEST)).toBe(true);
    expect(canRequest(newSeries, Permission.REQUEST)).toBe(true);
  });

  test("refuses someone without any request permission", () => {
    expect(canRequest(newFilm, 0)).toBe(false);
  });

  test("refuses a title the library has, or is fetching, or blocks", () => {
    for (const status of [
      MediaStatus.AVAILABLE,
      MediaStatus.PENDING,
      MediaStatus.PROCESSING,
      MediaStatus.BLOCKLISTED,
    ]) {
      const film = { ...newFilm, mediaInfo: known(status) };
      expect(canRequest(film, Permission.REQUEST)).toBe(false);
    }
  });

  test("refuses a title someone already asked for", () => {
    for (const status of [
      MediaRequestStatus.PENDING,
      MediaRequestStatus.APPROVED,
    ]) {
      const film = {
        ...newFilm,
        mediaInfo: known(MediaStatus.UNKNOWN, [request(status)]),
      };
      expect(canRequest(film, Permission.REQUEST)).toBe(false);
    }
  });

  test("lets a declined title be asked for again", () => {
    const film = {
      ...newFilm,
      mediaInfo: known(MediaStatus.UNKNOWN, [
        request(MediaRequestStatus.DECLINED),
      ]),
    };

    expect(canRequest(film, Permission.REQUEST)).toBe(true);
  });

  test("refuses when there is nothing to request", () => {
    expect(canRequest(undefined, Permission.REQUEST)).toBe(false);
  });
});

// Seerr keeps a standard and a 4K copy of a title apart (RequestButton): each
// has its own status, its own requests and its own permissions.
describe("canRequest in 4K", () => {
  const fourK = { is4k: true };
  const asked4k = (status: MediaRequestStatus): MediaRequest => ({
    ...request(status),
    is4k: true,
  });

  test("takes a 4K permission, for the kind of title", () => {
    expect(canRequest(newFilm, Permission.REQUEST, fourK)).toBe(false);
    expect(canRequest(newFilm, Permission.REQUEST_4K, fourK)).toBe(true);
    expect(canRequest(newFilm, Permission.REQUEST_4K_MOVIE, fourK)).toBe(true);
    expect(canRequest(newFilm, Permission.REQUEST_4K_TV, fourK)).toBe(false);
    expect(canRequest(newSeries, Permission.REQUEST_4K_TV, fourK)).toBe(true);
  });

  test("an administrator can", () => {
    expect(canRequest(newFilm, Permission.ADMIN, fourK)).toBe(true);
  });

  test("reads the 4K status, not the standard one", () => {
    const standardOnly = {
      ...newFilm,
      mediaInfo: { ...known(MediaStatus.AVAILABLE), status4k: undefined },
    };
    expect(canRequest(standardOnly, Permission.ADMIN)).toBe(false);
    expect(canRequest(standardOnly, Permission.ADMIN, fourK)).toBe(true);

    const fourKOnly = {
      ...newFilm,
      mediaInfo: {
        ...known(MediaStatus.UNKNOWN),
        status4k: MediaStatus.AVAILABLE,
      },
    };
    expect(canRequest(fourKOnly, Permission.ADMIN)).toBe(true);
    expect(canRequest(fourKOnly, Permission.ADMIN, fourK)).toBe(false);
  });

  // Counted together, a 4K request kept the standard copy from being asked
  // for, and the other way round (#601).
  test("counts only the requests of its own tier", () => {
    const asked4kOnly = {
      ...newFilm,
      mediaInfo: known(MediaStatus.UNKNOWN, [
        asked4k(MediaRequestStatus.PENDING),
      ]),
    };
    expect(canRequest(asked4kOnly, Permission.ADMIN)).toBe(true);
    expect(canRequest(asked4kOnly, Permission.ADMIN, fourK)).toBe(false);

    const askedStandardOnly = {
      ...newFilm,
      mediaInfo: known(MediaStatus.UNKNOWN, [
        request(MediaRequestStatus.APPROVED),
      ]),
    };
    expect(canRequest(askedStandardOnly, Permission.ADMIN)).toBe(false);
    expect(canRequest(askedStandardOnly, Permission.ADMIN, fourK)).toBe(true);
  });
});

// Seerr refuses a request that names its user, even the caller's own id,
// from anyone without both permissions, and lists its users for the same
// people only (MediaRequest.request, AdvancedRequester).
describe("canRequestForOthers", () => {
  test("takes Manage Users and Manage Requests together", () => {
    expect(
      canRequestForOthers(Permission.MANAGE_USERS | Permission.MANAGE_REQUESTS),
    ).toBe(true);
  });

  test("not with only one of them", () => {
    expect(canRequestForOthers(Permission.MANAGE_USERS)).toBe(false);
    expect(canRequestForOthers(Permission.MANAGE_REQUESTS)).toBe(false);
  });

  test("not with advanced requests", () => {
    expect(
      canRequestForOthers(Permission.REQUEST | Permission.REQUEST_ADVANCED),
    ).toBe(false);
  });

  test("an administrator can", () => {
    expect(canRequestForOthers(Permission.ADMIN)).toBe(true);
  });
});

// Seerr's "Request more" (RequestButton): a series Seerr knows, with a season
// it could still request, that the user may request series for. It opens the
// same season list as the first request.
describe("canRequestMore", () => {
  const seriesRequest: MediaRequest = {
    ...request(MediaRequestStatus.PENDING),
    seasons: [{ id: 1, seasonNumber: 1, status: MediaRequestStatus.PENDING }],
  } as MediaRequest;
  const series = (
    mediaInfo: MediaInfo | undefined,
    seasons = [0, 1, 2],
  ): TvDetails =>
    ({
      id: 1399,
      name: "Game of Thrones",
      seasons: seasons.map((seasonNumber) => ({
        id: seasonNumber,
        seasonNumber,
        episodeCount: 10,
      })),
      mediaInfo,
    }) as unknown as TvDetails;
  const partly = (status = MediaStatus.PENDING): MediaInfo => ({
    ...known(status, [seriesRequest]),
    mediaType: MediaType.TV,
  });

  test("offers it while a season is left to request", () => {
    expect(canRequestMore(series(partly()), Permission.REQUEST)).toBe(true);
    expect(canRequestMore(series(partly()), Permission.REQUEST_TV)).toBe(true);
  });

  // Seerr offers "Request more", not "Request", once it knows the series,
  // even when nothing is pending: a series partly in the library.
  test("offers it on a series partly in the library", () => {
    expect(
      canRequestMore(
        series({
          ...known(MediaStatus.PARTIALLY_AVAILABLE),
          mediaType: MediaType.TV,
        }),
        Permission.REQUEST,
      ),
    ).toBe(true);
  });

  test("not once every season is requested or in the library", () => {
    expect(canRequestMore(series(partly(), [1]), Permission.REQUEST)).toBe(
      false,
    );
  });

  test("counts the specials only when the server shows them", () => {
    const onlySpecialsLeft = series(partly(), [0, 1]);
    expect(canRequestMore(onlySpecialsLeft, Permission.REQUEST)).toBe(false);
    expect(
      canRequestMore(onlySpecialsLeft, Permission.REQUEST, { specials: true }),
    ).toBe(true);
  });

  // Seerr's plain Request covers a series it has never seen.
  test("not on a series Seerr does not know yet", () => {
    expect(canRequestMore(series(undefined), Permission.REQUEST)).toBe(false);
    expect(
      canRequestMore(
        series({ ...known(MediaStatus.UNKNOWN), mediaType: MediaType.TV }),
        Permission.REQUEST,
      ),
    ).toBe(false);
  });

  test("not on a blocklisted series", () => {
    expect(
      canRequestMore(
        series(partly(MediaStatus.BLOCKLISTED)),
        Permission.REQUEST,
      ),
    ).toBe(false);
  });

  test("not without a permission to request series", () => {
    expect(canRequestMore(series(partly()), Permission.REQUEST_MOVIE)).toBe(
      false,
    );
    expect(canRequestMore(series(partly()), 0)).toBe(false);
  });

  describe("in 4K", () => {
    const fourK = { is4k: true };
    const in4k = (status4k: MediaStatus, requests: MediaRequest[] = []) =>
      series({
        ...known(MediaStatus.AVAILABLE, requests),
        status4k,
        mediaType: MediaType.TV,
      });

    // A series in the library in standard only is new to the 4K tier: its
    // plain Request in 4K covers it.
    test("not while Seerr knows no 4K copy of the series", () => {
      expect(
        canRequestMore(in4k(MediaStatus.UNKNOWN), Permission.ADMIN, fourK),
      ).toBe(false);
    });

    test("offers it while a season is left to request in 4K", () => {
      const asked = in4k(MediaStatus.PROCESSING, [
        { ...seriesRequest, is4k: true },
      ]);
      expect(canRequestMore(asked, Permission.REQUEST_4K, fourK)).toBe(true);
      expect(canRequestMore(asked, Permission.REQUEST_4K_TV, fourK)).toBe(true);
    });

    test("not without a permission to request series in 4K", () => {
      const asked = in4k(MediaStatus.PROCESSING, [
        { ...seriesRequest, is4k: true },
      ]);
      expect(canRequestMore(asked, Permission.REQUEST, fourK)).toBe(false);
      expect(canRequestMore(asked, Permission.REQUEST_4K_MOVIE, fourK)).toBe(
        false,
      );
    });
  });
});

// Seerr sends a request to the default server of its tier, standard or 4K,
// unless an advanced request names another (MediaRequest.request).
describe("defaultServerFor", () => {
  const server = (
    id: number,
    is4k: boolean,
    isDefault: boolean,
  ): ServiceCommonServer => ({ id, name: `server ${id}`, is4k, isDefault });
  const servers = [
    server(0, false, true),
    server(1, true, true),
    server(2, false, false),
  ];

  test("picks the standard default for a standard request", () => {
    expect(defaultServerFor(servers, false)?.id).toBe(0);
  });

  test("picks the 4K default for a 4K request, wherever it is listed", () => {
    expect(defaultServerFor(servers, true)?.id).toBe(1);
    expect(defaultServerFor([...servers].reverse(), true)?.id).toBe(1);
  });

  test("finds none for a tier without a default server", () => {
    expect(defaultServerFor([server(0, false, true)], true)).toBeUndefined();
    expect(defaultServerFor(undefined, false)).toBeUndefined();
  });
});

// What a title's page offers, the phone's and the TV's alike, and what its
// seasons' own request buttons follow: Seerr's Request on a title it does
// not know, its Request more on a series it knows with seasons left.
describe("requestOffer", () => {
  const knownSeries = {
    id: 1399,
    name: "Game of Thrones",
    seasons: [1, 2].map((seasonNumber) => ({
      id: seasonNumber,
      seasonNumber,
      episodeCount: 10,
    })),
    mediaInfo: {
      ...known(MediaStatus.PARTIALLY_AVAILABLE),
      mediaType: MediaType.TV,
    },
  } as unknown as TvDetails;

  test("offers Request on a title Seerr does not know", () => {
    expect(requestOffer(newSeries, MediaType.TV, Permission.REQUEST)).toEqual({
      canRequest: true,
      requestMore: false,
      offersRequest: true,
    });
  });

  test("offers Request more on a series it knows with seasons left", () => {
    const offer = requestOffer(knownSeries, MediaType.TV, Permission.REQUEST);
    expect(offer.requestMore).toBe(true);
    expect(offer.offersRequest).toBe(true);
  });

  test("offers nothing to someone who may not request", () => {
    expect(requestOffer(knownSeries, MediaType.TV, 0).offersRequest).toBe(
      false,
    );
    expect(requestOffer(newSeries, MediaType.TV, 0).offersRequest).toBe(false);
  });

  test("never offers Request more on a film", () => {
    expect(
      requestOffer(filmDetails, MediaType.MOVIE, Permission.REQUEST)
        .requestMore,
    ).toBe(false);
  });

  // A series partly in the library in standard is new to the 4K tier.
  test("offers Request in 4K apart from the standard offer", () => {
    expect(
      requestOffer(knownSeries, MediaType.TV, Permission.REQUEST_4K, {
        is4k: true,
      }),
    ).toEqual({ canRequest: true, requestMore: false, offersRequest: true });
  });
});
