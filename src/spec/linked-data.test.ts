import { describe, expect, it, vi } from "vitest";
import { fundingReadWorkflows } from "./linked-data";
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
describe("funding linked-data recipes", () => {
  it("retains award and transaction envelopes without conflating sums", async () => {
    const detail = {total_obligation: 100, recipient: {uei: "123"}};
    const transactions = {results: [{federal_action_obligation: -5}], page_metadata: {hasNext: true}};
    const api = {get: vi.fn().mockResolvedValue(detail), post: vi.fn().mockResolvedValue(transactions)};
    const result = await new AsyncFunction("api", fundingReadWorkflows[0].code)(api);
    expect(result).toMatchObject({detail, transactions, complete: false});
    expect(api.post).toHaveBeenCalledWith("/usaspending/transactions/", expect.objectContaining({award_id: result.awardId, limit: 25}));
  });
  it("retains a staged award handle while continuing to transactions", async () => {
    const staged = {__staged: true, data_access_id: "fixture"};
    const transactions = {results: [], page_metadata: {hasNext: false}};
    const api = {get: vi.fn().mockResolvedValue(staged), post: vi.fn().mockResolvedValue(transactions)};
    expect(await new AsyncFunction("api", fundingReadWorkflows[0].code)(api)).toMatchObject({detail: staged, transactions, complete: false});
    expect(api.post).toHaveBeenCalledWith("/usaspending/transactions/", expect.objectContaining({page: 1, limit: 25}));
  });
  it("retains participant staging with the project context", async () => {
    const staged = {__staged: true, data_access_id: "roles"};
    const project = {results: {bindings: []}};
    const publications = {results: {bindings: []}};
    const api = {get: vi.fn().mockResolvedValueOnce(project).mockResolvedValueOnce(staged).mockResolvedValueOnce(publications)};
    expect(await new AsyncFunction("api", fundingReadWorkflows[1].code)(api)).toMatchObject({project, participants: staged, publications, complete: false});
    expect(api.get).toHaveBeenNthCalledWith(3, "/eurio/publications", {project_id: "101017453", limit: 25, offset: 0});
  });
  it("retains optional RDF fields and final publication errors", async () => {
    const project = {results: {bindings: []}};
    const participants = {results: {bindings: [{role: {type: "uri", value: "https://example.org/role"}}]}};
    const publications = {__api_error: true, status: 503};
    const api = {get: vi.fn().mockResolvedValueOnce(project).mockResolvedValueOnce(participants).mockResolvedValueOnce(publications)};
    expect(await new AsyncFunction("api", fundingReadWorkflows[1].code)(api)).toMatchObject({project, participants, publications, complete: false});
  });
});
