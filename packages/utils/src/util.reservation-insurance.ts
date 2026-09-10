/** Coverage badges require a contract created for this reservation on every surface. */
export const hasReservationInsuranceCoverage = ({
  tulipContractId,
  tulipContractStatus,
}: {
  tulipContractId: string | null;
  tulipContractStatus: string | null;
}): boolean =>
  Boolean(tulipContractId?.trim()) &&
  (tulipContractStatus === null ||
    tulipContractStatus === "created" ||
    tulipContractStatus === "updated");
