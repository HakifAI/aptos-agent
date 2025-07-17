import { Auth, HTTPException } from "@langchain/langgraph-sdk/auth";
import { verifyToken } from "./jwt.js";

export const auth = new Auth()
  .authenticate(async (request: Request) => {
    const authorization = request.headers.get("authorization");
    const token = authorization?.split(" ").at(-1);

    try {
      if (!token) {
        throw new Error("No token provided");
      }
      const payload = await verifyToken(token);

      return {
        identity: payload.sub + "",
        permissions: ["read", "write"],
        display_name: (payload.name || `User #${payload.sub}`) as string,
        email: payload.email,
        is_authenticated: true,
        walletAddress: payload.walletAddress,
      };
    } catch (error) {
      throw new HTTPException(401, { message: "Invalid token", cause: error });
    }
  })
  .on("*", ({ value, user }) => {
    // Add owner to the resource metadata
    if ("metadata" in value) {
      value.metadata ??= {};
      value.metadata.owner = user.identity;
      value.metadata.walletAddress = user.walletAddress;
    }

    // Filter the resource by the owner
    return { owner: user.identity };
  })
  .on("store", ({ user, value }) => {
    if (value.namespace != null) {
      // Assuming you organize information in store like (user_id, resource_type, resource_id)
      const [userId] = value.namespace;
      if (userId !== user.identity) {
        throw new HTTPException(403, { message: "Not authorized" });
      }
    }
  });
